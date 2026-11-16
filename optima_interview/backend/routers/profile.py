import io
import os
import secrets
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
import auth as auth_utils

router = APIRouter(prefix="/profile", tags=["profile"])

BLOB_TOKEN = os.getenv("BLOB_READ_WRITE_TOKEN")
BLOB_API_URL = "https://blob.vercel-storage.com"
LOCAL_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_RESUME_TYPES = {"application/pdf"}

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_RESUME_PAGES = 30


async def read_upload(file: UploadFile) -> bytes:
    """The bytes of an uploaded file, refused if it is larger than the limit."""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is larger than 5 MB. Choose a smaller one.")
    if not content:
        raise HTTPException(status_code=400, detail="That file is empty.")
    return content


def image_kind(content: bytes) -> Optional[str]:
    """What kind of picture these bytes really are, whatever the upload called itself."""
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if content[:3] == b"\xff\xd8\xff":
        return "jpg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    return None


def is_pdf(content: bytes) -> bool:
    return b"%PDF-" in content[:1024]


def private_name(folder: str, stem: str, ext: str) -> str:
    """Where a file is kept. The random part means its address cannot be worked out from an account
    number: the files are served to anyone who has the address, so the address has to be unguessable."""
    return f"{folder}/{stem}_{secrets.token_urlsafe(16)}.{ext}"


def _upload_file(file_content: bytes, pathname: str, content_type: str) -> str:
    """Upload bytes to Vercel Blob (production) or local disk (dev). Returns public URL."""
    if BLOB_TOKEN:
        response = httpx.put(
            f"{BLOB_API_URL}/{pathname}",
            content=file_content,
            headers={
                "authorization": f"Bearer {BLOB_TOKEN}",
                "x-api-version": "7",
                "content-type": content_type,
                "x-add-random-suffix": "0",
            },
            timeout=30.0,
        )
        if response.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail="The file could not be stored. Try again in a moment.")
        return response.json()["url"]

    # Local fallback for development
    local_path = LOCAL_UPLOAD_DIR / pathname
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(file_content)
    except OSError:
        # a hosted server with no file storage set up has nowhere to put it
        raise HTTPException(status_code=503, detail="File storage is not set up on this server.")
    return f"/uploads/{pathname}"


def _delete_file(url: str) -> None:
    """Delete a blob by its public URL, or a local file. Silently ignores errors."""
    if not url:
        return
    # Vercel Blob
    if BLOB_TOKEN and "blob.vercel-storage.com" in url:
        try:
            httpx.delete(
                BLOB_API_URL,
                headers={"authorization": f"Bearer {BLOB_TOKEN}", "x-api-version": "7"},
                params={"url": url},
                timeout=10.0,
            )
        except Exception:
            pass
        return
    # Local file
    if url.startswith("/uploads/"):
        try:
            local_path = LOCAL_UPLOAD_DIR / url.replace("/uploads/", "", 1)
            local_path.unlink(missing_ok=True)
        except Exception:
            pass


def _extract_resume_text(file_content: bytes, content_type: str) -> str:
    """Extract text from resume bytes."""
    if content_type == "text/plain":
        return file_content.decode("utf-8", errors="replace")

    if content_type == "application/pdf":
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_content)) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages[:MAX_RESUME_PAGES])
                return text[: schemas.RESUME_CHARS]
        except Exception:
            return ""

    if "wordprocessingml" in content_type:
        try:
            from docx import Document
            doc = Document(io.BytesIO(file_content))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception:
            return ""

    return ""


@router.get("/me", response_model=schemas.UserProfileOut)
def get_my_profile(
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    return schemas.UserProfileOut.model_validate(current_user)


@router.patch("/me", response_model=schemas.UserProfileOut)
def update_my_profile(
    payload: schemas.UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    updates = payload.model_dump(exclude_unset=True)

    if "desired_roles" in updates and updates["desired_roles"] is not None:
        if len(updates["desired_roles"]) > 5:
            raise HTTPException(status_code=400, detail="Maximum 5 desired roles allowed")

    # one end of the pay range sent on its own is checked against the end already saved
    pay_min = updates.get("pay_min", current_user.pay_min)
    pay_max = updates.get("pay_max", current_user.pay_max)
    if ("pay_min" in updates or "pay_max" in updates) and pay_min is not None and pay_max is not None and pay_min > pay_max:
        raise HTTPException(status_code=422, detail="Minimum pay must be less than or equal to maximum pay")

    for field, value in updates.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return schemas.UserProfileOut.model_validate(current_user)


@router.post("/avatar", response_model=schemas.UserProfileOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    refusal = HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, or GIF images are allowed")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise refusal
    file_content = await read_upload(file)
    kind = image_kind(file_content)
    if kind is None:
        raise refusal  # it says it is a picture and is not one

    previous = current_user.profile_picture_url
    content_type = "image/jpeg" if kind == "jpg" else f"image/{kind}"
    url = _upload_file(file_content, private_name("avatars", f"avatar_{current_user.id}", kind), content_type)

    current_user.profile_picture_url = url
    db.commit()
    db.refresh(current_user)
    if previous and previous != url:
        _delete_file(previous)  # only once the new one is safely in place
    return schemas.UserProfileOut.model_validate(current_user)


@router.post("/resume", response_model=schemas.UserProfileOut)
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    refusal = HTTPException(status_code=400, detail="Only PDF resumes are allowed")
    if file.content_type not in ALLOWED_RESUME_TYPES:
        raise refusal
    file_content = await read_upload(file)
    if not is_pdf(file_content):
        raise refusal

    previous = current_user.resume_filename
    url = _upload_file(file_content, private_name("resumes", f"resume_{current_user.id}", "pdf"), "application/pdf")
    resume_text = _extract_resume_text(file_content, "application/pdf")

    current_user.resume_filename = url
    current_user.resume_text = resume_text
    db.commit()
    db.refresh(current_user)
    if previous and previous != url:
        _delete_file(previous)
    return schemas.UserProfileOut.model_validate(current_user)


# What a company may know about a candidate. Age, sex, gender, ethnicity and disability
# are never part of it: they have no place in a hiring decision.
_PRIVATE_FROM_COMPANIES = ("age", "sex", "gender", "ethnicity", "disabilities")


@router.get("/{user_id}", response_model=schemas.UserProfileOut)
def get_candidate_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_company),
):
    """Company-only: the profile of a candidate who has applied to one of this company's roles."""
    candidate = db.query(models.User).filter(
        models.User.id == user_id,
        models.User.role == "candidate",
    ).first()
    applied = candidate is not None and (
        db.query(models.Application)
        .join(models.JobPosting, models.Application.job_id == models.JobPosting.id)
        .filter(
            models.Application.candidate_user_id == user_id,
            models.Application.status != "withdrawn",
            models.JobPosting.company_user_id == current_user.id,
        )
        .first()
    )
    if not applied:
        # the same reply whether the person does not exist or has not applied here
        raise HTTPException(status_code=404, detail="Candidate not found")
    profile = schemas.UserProfileOut.model_validate(candidate)
    for field in _PRIVATE_FROM_COMPANIES:
        setattr(profile, field, None)
    return profile
