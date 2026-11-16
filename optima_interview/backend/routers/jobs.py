from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
import auth as auth_utils

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _contains(column, text: str):
    """A search for `text` anywhere in a column, with % and _ in the text taken as written."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


def _enrich_job(job: models.JobPosting, company_name: str, db: Session) -> schemas.JobOut:
    """Attach company name and applicant count stats to a JobOut."""
    out = schemas.JobOut.model_validate(job)
    out.company_name = company_name

    count_65 = (
        db.query(models.Application)
        .filter(
            models.Application.job_id == job.id,
            models.Application.match_score >= 65,
            models.Application.status != "withdrawn",
        )
        .count()
    )
    count_80 = (
        db.query(models.Application)
        .filter(
            models.Application.job_id == job.id,
            models.Application.match_score >= 80,
            models.Application.status != "withdrawn",
        )
        .count()
    )
    out.candidate_count_65 = count_65
    out.candidate_count_80 = count_80
    return out


@router.post("/", response_model=schemas.JobOut, status_code=status.HTTP_201_CREATED)
def create_job(
    payload: schemas.JobCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_company),
):
    if payload.specific_questions and len(payload.specific_questions) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 specific questions allowed")

    job = models.JobPosting(
        company_user_id=current_user.id,
        title=payload.title,
        industry=payload.industry,
        description=payload.description or "",
        required_skills=payload.required_skills or [],
        location=payload.location,
        location_type=payload.location_type or "hybrid",
        responsibilities=payload.responsibilities,
        education_required=payload.education_required,
        experience_required=payload.experience_required,
        certifications_required=payload.certifications_required,
        salary_min=payload.salary_min,
        salary_max=payload.salary_max,
        hours_type=payload.hours_type,
        job_level=payload.job_level,
        specific_questions=payload.specific_questions or [],
        start_date=payload.start_date,
        work_term=payload.work_term,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _enrich_job(job, current_user.name, db)


@router.get("/mine/past", response_model=List[schemas.JobOut])
def my_past_jobs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_company),
):
    jobs = (
        db.query(models.JobPosting)
        .filter(
            models.JobPosting.company_user_id == current_user.id,
            models.JobPosting.is_active == False,
        )
        .order_by(models.JobPosting.created_at.desc())
        .all()
    )
    return [_enrich_job(j, current_user.name, db) for j in jobs]


@router.get("/mine", response_model=List[schemas.JobOut])
def my_jobs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_company),
):
    jobs = (
        db.query(models.JobPosting)
        .filter(
            models.JobPosting.company_user_id == current_user.id,
            models.JobPosting.is_active == True,
        )
        .order_by(models.JobPosting.created_at.desc())
        .all()
    )
    return [_enrich_job(j, current_user.name, db) for j in jobs]


@router.get("/", response_model=List[schemas.JobOut])
def list_jobs(
    industry: Optional[str] = Query(None),
    location_type: Optional[str] = Query(None),
    hours_type: Optional[str] = Query(None),
    job_level: Optional[str] = Query(None),
    salary_min: Optional[int] = Query(None),
    salary_max: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    work_term: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(models.JobPosting).filter(models.JobPosting.is_active == True)
    if industry:
        query = query.filter(models.JobPosting.industry == industry)
    if location_type and location_type != "any":
        query = query.filter(models.JobPosting.location_type == location_type)
    if hours_type and hours_type != "any":
        query = query.filter(models.JobPosting.hours_type == hours_type)
    if job_level:
        query = query.filter(models.JobPosting.job_level == job_level)
    if salary_min is not None:
        query = query.filter(
            (models.JobPosting.salary_max >= salary_min) |
            (models.JobPosting.salary_max == None)
        )
    if salary_max is not None:
        query = query.filter(
            (models.JobPosting.salary_min <= salary_max) |
            (models.JobPosting.salary_min == None)
        )
    if start_date:
        query = query.filter(_contains(models.JobPosting.start_date, start_date))
    if work_term:
        query = query.filter(_contains(models.JobPosting.work_term, work_term))

    jobs = query.order_by(models.JobPosting.created_at.desc()).all()
    return [_enrich_job(j, j.company.name if j.company else "", db) for j in jobs]


@router.get("/{job_id}", response_model=schemas.JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.JobPosting).filter(models.JobPosting.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _enrich_job(job, job.company.name if job.company else "", db)


@router.patch("/{job_id}", response_model=schemas.JobOut)
def update_job(
    job_id: int,
    payload: schemas.JobUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_company),
):
    job = db.query(models.JobPosting).filter(models.JobPosting.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.company_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job posting")

    updates = payload.model_dump(exclude_unset=True)
    # these can be changed but never emptied: an empty value means "leave it as it is"
    for field in ("title", "description", "location_type", "is_active"):
        if field in updates and updates[field] is None:
            del updates[field]
    for field in ("required_skills", "specific_questions"):
        if field in updates and updates[field] is None:
            updates[field] = []
    if "specific_questions" in updates and len(updates["specific_questions"]) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 specific questions allowed")

    # one end of the salary range sent on its own is checked against the end already saved
    salary_min = updates.get("salary_min", job.salary_min)
    salary_max = updates.get("salary_max", job.salary_max)
    if ("salary_min" in updates or "salary_max" in updates) and salary_min is not None and salary_max is not None and salary_min > salary_max:
        raise HTTPException(status_code=422, detail="Minimum salary must be less than or equal to maximum salary")

    for field, value in updates.items():
        setattr(job, field, value)

    # Track deactivation time
    if "is_active" in updates and updates["is_active"] is False and job.deactivated_at is None:
        job.deactivated_at = datetime.utcnow()
    elif "is_active" in updates and updates["is_active"] is True:
        job.deactivated_at = None

    db.commit()
    db.refresh(job)
    return _enrich_job(job, current_user.name, db)
