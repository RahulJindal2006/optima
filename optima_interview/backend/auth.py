import hashlib
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
import models

_DEV_SECRET = "nexus-dev-secret-change-in-production"


def _secret_key() -> str:
    """The key that signs sign-in tokens.

    SECRET_KEY should be set on a live server. The fallback written in this file is public (it is
    in the repository), so anyone could sign a token for any account with it. If a live server has
    no SECRET_KEY, or still has the fallback, a private key is worked out from the database
    address instead, which only the server knows. Locally, with the SQLite file, the fallback is fine.
    """
    key = os.getenv("SECRET_KEY") or _DEV_SECRET
    database = os.getenv("DATABASE_URL", "")
    if key == _DEV_SECRET and database and not database.startswith("sqlite"):
        key = hashlib.sha256(("optima-sign-in:" + database).encode("utf-8")).hexdigest()
    return key


SECRET_KEY = _secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int, email: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    refused = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise refused
    # every token this server signs names its account; one that does not was not signed here
    if not str(payload.get("sub", "")).isdigit():
        raise refused
    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    payload = decode_token(credentials.credentials)
    user_id = int(payload["sub"])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_candidate(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != "candidate":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Candidates only")
    return current_user


def require_company(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != "company":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Companies only")
    return current_user
