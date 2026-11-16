import os
from sqlalchemy import create_engine, inspect as _inspect, text as _text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

# In production (Vercel), DATABASE_URL is injected by Vercel Postgres (Neon).
# Locally, fall back to SQLite for development.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nexus.db")

# Neon connection strings start with "postgres://" but SQLAlchemy requires "postgresql://".
# The driver is named outright. Left unnamed, SQLAlchemy 2.1 and later pick psycopg 3, which is
# not installed (requirements.txt has psycopg2), and the server cannot start.
for _prefix in ("postgres://", "postgresql://"):
    if DATABASE_URL.startswith(_prefix):
        DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len(_prefix):]
        break

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    # NullPool is critical for serverless — prevents stale connections across invocations
    engine = create_engine(DATABASE_URL, poolclass=NullPool)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_missing_columns() -> None:
    """Add any column the models have and an existing table lacks.

    create_all() makes new tables but never changes one that is already there, so a column added
    to a model would otherwise be missing from a database made by an earlier version. Only columns
    that may be empty are added: nothing is dropped, renamed or filled in.
    """
    inspector = _inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present or column.primary_key or not column.nullable:
                continue
            kind = column.type.compile(dialect=engine.dialect)
            try:
                with engine.begin() as conn:
                    conn.execute(_text(f"ALTER TABLE {table.name} ADD COLUMN {column.name} {kind}"))
            except Exception:
                pass  # another copy of the server added it first


def init_db():
    from models import Base  # noqa: F401 — ensures all models are registered
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
