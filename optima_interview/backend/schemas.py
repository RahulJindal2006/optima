from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, EmailStr, field_validator, model_validator

# How much text one field may hold. Generous for a person, small enough that nobody can fill the database.
NAME_CHARS = 120
LINE_CHARS = 200
LONG_CHARS = 20_000
RESUME_CHARS = 100_000
MAX_MONEY = 100_000_000

WORK_TYPES = ("onsite", "hybrid", "remote")
HOURS_TYPES = ("full_time", "part_time", "contract")
LEVELS = ("internship", "entry", "senior")


def _named(info) -> str:
    """The field a check is about, as words: "cover_letter_text" becomes "Cover letter text"."""
    name = getattr(info, "field_name", None) or "this"
    return name.replace("_", " ").capitalize()


def _line(value, info, limit: int = LINE_CHARS):
    """One line of text: trimmed, empty becomes nothing, too long is refused."""
    if value is None:
        return None
    value = " ".join(str(value).split())
    if len(value) > limit:
        raise ValueError(f"{_named(info)} must be {limit} characters or fewer")
    return value or None


def _long(value, info, limit: int = LONG_CHARS):
    if value is not None and len(value) > limit:
        raise ValueError(f"{_named(info)} must be {limit:,} characters or fewer")
    return value


def _one_of(value, info, allowed):
    if value in (None, ""):
        return None
    if value not in allowed:
        raise ValueError(f"{_named(info)} must be one of: " + ", ".join(allowed))
    return value


def _tags(value, most: int, what: str):
    """A list of short labels (skills, roles, places): trimmed, blanks and repeats dropped."""
    if value is None:
        return None
    if len(value) > most * 10:
        raise ValueError(f"At most {most} {what}")
    kept, seen = [], set()
    for item in value:
        item = " ".join(str(item).split())
        if not item or item.lower() in seen:
            continue
        if len(item) > NAME_CHARS:
            raise ValueError(f"Each of the {what} must be {NAME_CHARS} characters or fewer")
        seen.add(item.lower())
        kept.append(item)
    if len(kept) > most:
        raise ValueError(f"At most {most} {what}")
    return kept


def _money(value, info):
    if value is not None and not (0 <= value <= MAX_MONEY):
        raise ValueError(f"{_named(info)} must be between 0 and 100,000,000")
    return value


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    role: str  # "candidate" | "company"

    # Candidate fields
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    # Company fields
    company_name: Optional[str] = None
    location: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(v) > 256:
            raise ValueError("Password must be 256 characters or fewer")
        return v

    @field_validator("email")
    @classmethod
    def email_lowercase(cls, v: str) -> str:
        return v.lower().strip()

    # a name made only of spaces is no name: it becomes nothing, and the sign-up is refused for lacking one
    @field_validator("first_name", "last_name", "company_name", "location")
    @classmethod
    def tidy_names(cls, v, info):
        return _line(v, info, NAME_CHARS)


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def email_lowercase(cls, v: str) -> str:
        return v.lower().strip()


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserProfileOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    created_at: datetime

    # Contact
    phone_number: Optional[str] = None
    profile_picture_url: Optional[str] = None

    # About
    age: Optional[int] = None
    sex: Optional[str] = None
    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    disabilities: Optional[str] = None

    # Resume
    resume_text: Optional[str] = None
    resume_filename: Optional[str] = None

    # Preferences
    skills: Optional[List[str]] = None
    desired_roles: Optional[List[str]] = None
    location: Optional[str] = None
    distance_km: Optional[int] = None
    work_type: Optional[str] = None
    pay_min: Optional[int] = None
    pay_max: Optional[int] = None
    hours_type: Optional[str] = None
    level: Optional[str] = None
    start_date: Optional[str] = None
    work_term: Optional[str] = None

    # Company
    company_description: Optional[str] = None
    company_locations: Optional[List[str]] = None

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    phone_number: Optional[str] = None
    age: Optional[int] = None
    sex: Optional[str] = None
    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    disabilities: Optional[str] = None
    resume_text: Optional[str] = None
    skills: Optional[List[str]] = None
    desired_roles: Optional[List[str]] = None
    location: Optional[str] = None
    distance_km: Optional[int] = None
    work_type: Optional[str] = None
    pay_min: Optional[int] = None
    pay_max: Optional[int] = None
    hours_type: Optional[str] = None
    level: Optional[str] = None
    start_date: Optional[str] = None
    work_term: Optional[str] = None
    company_description: Optional[str] = None
    company_locations: Optional[List[str]] = None

    @field_validator("age")
    @classmethod
    def age_in_range(cls, v):
        if v is not None and not (13 <= v <= 120):
            raise ValueError("Age must be between 13 and 120")
        return v

    @field_validator("pay_min", "pay_max")
    @classmethod
    def pay_in_range(cls, v, info):
        return _money(v, info)

    @field_validator("distance_km")
    @classmethod
    def distance_in_range(cls, v):
        if v is not None and not (0 <= v <= 20_000):
            raise ValueError("Distance must be between 0 and 20,000 km")
        return v

    @field_validator("phone_number", "sex", "gender", "ethnicity", "disabilities", "location", "start_date", "work_term")
    @classmethod
    def tidy_lines(cls, v, info):
        return _line(v, info)

    @field_validator("work_type")
    @classmethod
    def known_work_type(cls, v, info):
        return _one_of(v, info, WORK_TYPES + ("any",))

    @field_validator("hours_type")
    @classmethod
    def known_hours(cls, v, info):
        return _one_of(v, info, HOURS_TYPES + ("any",))

    @field_validator("level")
    @classmethod
    def known_level(cls, v, info):
        return _one_of(v, info, LEVELS)

    @field_validator("skills")
    @classmethod
    def tidy_skills(cls, v):
        return _tags(v, 60, "skills")

    @field_validator("desired_roles")
    @classmethod
    def tidy_roles(cls, v):
        # the limit of five is checked where the profile is saved, which words the refusal
        return _tags(v, 50, "roles")

    @field_validator("company_locations")
    @classmethod
    def tidy_places(cls, v):
        return _tags(v, 30, "locations")

    @field_validator("resume_text")
    @classmethod
    def resume_length(cls, v, info):
        return _long(v, info, RESUME_CHARS)

    @field_validator("company_description")
    @classmethod
    def description_length(cls, v, info):
        return _long(v, info)

    @model_validator(mode="after")
    def pay_min_lte_max(self):
        if self.pay_min is not None and self.pay_max is not None and self.pay_min > self.pay_max:
            raise ValueError("Minimum pay must be less than or equal to maximum pay")
        return self


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfileOut


# ── Interviews ────────────────────────────────────────────────────────────────

class InterviewStart(BaseModel):
    job_title: Optional[str] = None
    industry: Optional[str] = None
    session_type: Literal["mock", "connecting"] = "mock"
    favourite_job_ids: Optional[List[int]] = []   # used for connecting type

    @field_validator("job_title", "industry")
    @classmethod
    def tidy_lines(cls, v, info):
        return _line(v, info, NAME_CHARS)

    @model_validator(mode="after")
    def practice_names_its_role(self):
        # checked before anything is written, so a bad request never uses up an interview
        if self.session_type == "mock" and not (self.job_title and self.industry):
            raise ValueError("A practice interview needs a role and a field")
        return self


class QuestionOut(BaseModel):
    id: int
    question_text: str
    question_type: str  # "verbal" | "code"
    question_order: int

    class Config:
        from_attributes = True


class OutlineItem(BaseModel):
    """What a candidate may know before a question is asked: its kind and its time limit."""
    question_order: int
    question_type: str
    seconds: int
    category: Optional[str] = None   # "general" | "role" | "long" | "code"


class InterviewRules(BaseModel):
    locked: bool                  # the weekly interview: leaving counts, and closing ends it
    leaves_allowed: int
    begin_within_seconds: int
    grace_seconds: int
    check_in_seconds: int = 20


class InterviewStartResponse(BaseModel):
    """Questions are written, but none is shown until the candidate presses Begin."""
    session_id: int
    job_title: str
    industry: str
    session_type: str
    question_count: int
    outline: List[OutlineItem]
    rules: InterviewRules
    begin_seconds_left: int   # how long is left to press Begin before the interview closes unused


class QuestionServed(BaseModel):
    id: int
    question_text: str
    question_type: str
    question_order: int
    seconds: int        # the full time for this question
    seconds_left: int   # counted on the server from the moment it was shown


class InterviewBegin(BaseModel):
    attempt: str

    @field_validator("attempt")
    @classmethod
    def attempt_shape(cls, v: str) -> str:
        if not (16 <= len(v) <= 64):
            raise ValueError("attempt must be 16 to 64 characters")
        return v


class InterviewBeginResponse(BaseModel):
    question: QuestionServed
    question_count: int


class AnswerIn(BaseModel):
    attempt: str
    question_id: int
    answer: str = ""
    # from the page: characters typed and dictated, paste attempts, what the camera saw (seconds), voice heard (seconds)
    signals: Optional[dict] = None


class AnswerResponse(BaseModel):
    next: Optional[QuestionServed] = None
    answered: int
    late: bool = False


class EventIn(BaseModel):
    attempt: str
    type: str                  # "left" | "returned" | "paste"
    how: Optional[str] = None  # "hidden" | "blur" | "fullscreen"
    ms: Optional[int] = None   # how long the candidate was away, sent with "returned"


class EventResponse(BaseModel):
    left_count: int
    leaves_allowed: int
    ended: bool
    ended_reason: Optional[str] = None


class PingIn(BaseModel):
    attempt: str


class PingResponse(BaseModel):
    ended: bool
    ended_reason: Optional[str] = None
    seconds_left: Optional[int] = None


class FinishIn(BaseModel):
    attempt: Optional[str] = None
    delivery: Optional[dict] = None   # what the camera coach measured, as numbers
    # Scoring stops and reports back after this many seconds; the page then asks again and it
    # carries on where it stopped. The server has its own limit, which this can only shorten.
    budget_seconds: Optional[float] = None


class FairPlay(BaseModel):
    left_count: int
    leaves_allowed: int
    away_seconds: int
    paste_attempts: int
    late_answers: int
    manipulation_answers: int
    unexplained_answers: int
    voice_mismatch_answers: int = 0          # dictated text with almost no voice behind it
    camera: Optional[dict] = None            # time off camera, time looking away, a second person; None before the camera was required
    ended_reason: Optional[str] = None
    clean: bool


class AnswerSubmit(BaseModel):
    question_id: int
    answer: str


class InterviewSubmit(BaseModel):
    answers: List[AnswerSubmit]


class QuestionResult(BaseModel):
    id: int
    question_text: str
    question_type: str
    user_answer: Optional[str]
    score: Optional[float]
    feedback: Optional[str]
    key_points: Optional[List[str]]
    key_points_hit: Optional[List[str]]
    question_order: int
    seconds: Optional[int] = None    # time spent on it
    seconds_allowed: Optional[int] = None
    category: Optional[str] = None   # "general" | "role" | "long" | "code"
    late: bool = False               # the answer arrived after the clock ran out, so it was not counted
    ungraded: bool = False           # the grader failed on it: left out of the score
    flagged: Optional[str] = None    # "manipulation" | "unexplained" | "voice"
    rubric: Optional[dict] = None    # the scorecard: each line, the level picked, what it earned

    class Config:
        from_attributes = True


class InterviewResultResponse(BaseModel):
    session_id: int
    job_title: str
    industry: str
    session_type: str
    overall_score: Optional[float]
    status: str
    created_at: datetime
    completed_at: Optional[datetime]
    questions: List[QuestionResult]
    ended_reason: Optional[str] = None       # set when the interview ended early
    awaiting_scoring: bool = False           # every answer is in, scoring has not finished
    fair_play: Optional[FairPlay] = None     # weekly interviews only
    delivery: Optional[dict] = None          # what the camera coach measured: shown to the candidate only
    scorecard: Optional[dict] = None         # how the score was reached: questions answered, what the camera cost

    class Config:
        from_attributes = True


class SessionSummary(BaseModel):
    id: int
    job_title: str
    industry: str
    overall_score: Optional[float]
    status: str
    session_type: str
    created_at: datetime
    ended_reason: Optional[str] = None
    awaiting_scoring: bool = False           # every answer is in, scoring has not finished
    delivery: Optional[dict] = None          # eye contact and posture, for the trend across practices
    answered: Optional[int] = None           # questions answered, of `question_count`
    question_count: Optional[int] = None
    incomplete: bool = False                 # too few questions were answered for it to be sent anywhere

    class Config:
        from_attributes = True


class ConnectAvailability(BaseModel):
    can_connect: bool
    next_available: Optional[str] = None   # ISO datetime string


# ── Jobs ──────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    title: str
    industry: str
    description: Optional[str] = ""
    required_skills: Optional[List[str]] = []
    location: Optional[str] = None
    location_type: Optional[str] = "hybrid"
    responsibilities: Optional[str] = None
    education_required: Optional[str] = None
    experience_required: Optional[str] = None
    certifications_required: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    hours_type: Optional[str] = None
    job_level: Optional[str] = None
    specific_questions: Optional[List[str]] = []
    start_date: Optional[str] = None
    work_term: Optional[str] = None

    @field_validator("title")
    @classmethod
    def tidy_title(cls, v, info):
        v = _line(v, info, LINE_CHARS)
        if not v:
            raise ValueError("A role needs a title")
        return v

    @field_validator("description", "responsibilities")
    @classmethod
    def long_text(cls, v, info):
        return _long(v, info)

    @field_validator("location", "education_required", "experience_required", "certifications_required", "start_date", "work_term")
    @classmethod
    def tidy_lines(cls, v, info):
        return _line(v, info, 500)

    @field_validator("location_type")
    @classmethod
    def known_arrangement(cls, v, info):
        return _one_of(v, info, WORK_TYPES)

    @field_validator("hours_type")
    @classmethod
    def known_hours(cls, v, info):
        return _one_of(v, info, HOURS_TYPES)

    @field_validator("job_level")
    @classmethod
    def known_level(cls, v, info):
        return _one_of(v, info, LEVELS)

    @field_validator("salary_min", "salary_max")
    @classmethod
    def salary_in_range(cls, v, info):
        return _money(v, info)

    @field_validator("required_skills")
    @classmethod
    def tidy_skills(cls, v):
        return _tags(v, 60, "skills")

    @field_validator("specific_questions")
    @classmethod
    def tidy_questions(cls, v):
        if v is None:
            return None
        kept = [" ".join(str(q).split()) for q in v]
        kept = [q for q in kept if q]
        if any(len(q) > 600 for q in kept):
            raise ValueError("Each question must be 600 characters or fewer")
        return kept

    @field_validator("industry")
    @classmethod
    def tidy_industry(cls, v, info):
        v = _line(v, info, NAME_CHARS)
        if not v:
            raise ValueError("A role needs a field")
        return v

    @model_validator(mode="after")
    def salary_min_lte_max(self):
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("Minimum salary must be less than or equal to maximum salary")
        return self


class JobOut(BaseModel):
    id: int
    company_user_id: int
    title: str
    industry: str
    description: Optional[str] = ""
    required_skills: Optional[List[str]]
    location: Optional[str] = None
    location_type: str
    is_active: bool
    created_at: datetime
    company_name: Optional[str] = None

    # Extended fields
    responsibilities: Optional[str] = None
    education_required: Optional[str] = None
    experience_required: Optional[str] = None
    certifications_required: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    hours_type: Optional[str] = None
    job_level: Optional[str] = None
    specific_questions: Optional[List[str]] = None
    start_date: Optional[str] = None
    work_term: Optional[str] = None

    # Computed applicant counts (populated at query time)
    candidate_count_65: Optional[int] = None
    candidate_count_80: Optional[int] = None

    class Config:
        from_attributes = True


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    is_active: Optional[bool] = None
    responsibilities: Optional[str] = None
    education_required: Optional[str] = None
    experience_required: Optional[str] = None
    certifications_required: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    hours_type: Optional[str] = None
    job_level: Optional[str] = None
    specific_questions: Optional[List[str]] = None
    start_date: Optional[str] = None
    work_term: Optional[str] = None

    @field_validator("title")
    @classmethod
    def tidy_title(cls, v, info):
        if v is None:
            return None  # not being changed
        v = _line(v, info, LINE_CHARS)
        if not v:
            raise ValueError("A role needs a title")
        return v

    @field_validator("description", "responsibilities")
    @classmethod
    def long_text(cls, v, info):
        return _long(v, info)

    @field_validator("location", "education_required", "experience_required", "certifications_required", "start_date", "work_term")
    @classmethod
    def tidy_lines(cls, v, info):
        return _line(v, info, 500)

    @field_validator("location_type")
    @classmethod
    def known_arrangement(cls, v, info):
        return _one_of(v, info, WORK_TYPES)

    @field_validator("hours_type")
    @classmethod
    def known_hours(cls, v, info):
        return _one_of(v, info, HOURS_TYPES)

    @field_validator("job_level")
    @classmethod
    def known_level(cls, v, info):
        return _one_of(v, info, LEVELS)

    @field_validator("salary_min", "salary_max")
    @classmethod
    def salary_in_range(cls, v, info):
        return _money(v, info)

    @field_validator("required_skills")
    @classmethod
    def tidy_skills(cls, v):
        return _tags(v, 60, "skills")

    @field_validator("specific_questions")
    @classmethod
    def tidy_questions(cls, v):
        if v is None:
            return None
        kept = [" ".join(str(q).split()) for q in v]
        kept = [q for q in kept if q]
        if any(len(q) > 600 for q in kept):
            raise ValueError("Each question must be 600 characters or fewer")
        return kept

    @model_validator(mode="after")
    def salary_min_lte_max(self):
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("Minimum salary must be less than or equal to maximum salary")
        return self


# ── Favourites ────────────────────────────────────────────────────────────────

class FavouriteOut(BaseModel):
    id: int
    job_id: int
    created_at: datetime
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    industry: Optional[str] = None
    location_type: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    hours_type: Optional[str] = None
    job_level: Optional[str] = None

    class Config:
        from_attributes = True


# ── Applications ──────────────────────────────────────────────────────────────

class ApplicationOut(BaseModel):
    id: int
    job_id: int
    session_id: int
    match_score: float
    interview_performance_score: Optional[float] = None
    answer_relevance_score: Optional[float] = None
    profile_skills_score: Optional[float] = None
    ats_score: Optional[float] = None
    tailored_resume_text: Optional[str] = None
    tailored_resume_filename: Optional[str] = None
    cover_letter_text: Optional[str] = None
    cover_letter_filename: Optional[str] = None
    status: str
    reasoning: Optional[str] = None
    created_at: datetime
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    industry: Optional[str] = None

    class Config:
        from_attributes = True


class ApplicationUpdate(BaseModel):
    tailored_resume_text: Optional[str] = None
    cover_letter_text: Optional[str] = None

    @field_validator("tailored_resume_text")
    @classmethod
    def resume_length(cls, v, info):
        return _long(v, info, RESUME_CHARS)

    @field_validator("cover_letter_text")
    @classmethod
    def letter_length(cls, v, info):
        return _long(v, info)


class ApplicantDetail(BaseModel):
    """Full applicant info returned to companies."""
    application_id: int
    match_score: float
    interview_performance_score: Optional[float] = None
    answer_relevance_score: Optional[float] = None
    profile_skills_score: Optional[float] = None
    ats_score: Optional[float] = None
    status: str
    reasoning: Optional[str] = None
    tailored_resume_text: Optional[str] = None
    tailored_resume_filename: Optional[str] = None
    cover_letter_text: Optional[str] = None
    cover_letter_filename: Optional[str] = None
    resume_is_tailored: bool

    # Candidate profile info
    candidate_id: int
    candidate_name: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    candidate_location: Optional[str] = None
    candidate_age: Optional[int] = None
    candidate_profile_picture_url: Optional[str] = None
    candidate_skills: Optional[List[str]] = None
    candidate_resume_text: Optional[str] = None
    candidate_resume_filename: Optional[str] = None

    # How the interview behind this application was taken. None: taken before fair-play checks.
    fair_play: Optional[FairPlay] = None

    class Config:
        from_attributes = True


# ── Matches ───────────────────────────────────────────────────────────────────

class MatchOut(BaseModel):
    id: int
    job_id: int
    candidate_user_id: int
    session_id: int
    match_score: float
    reasoning: Optional[str] = None
    status: str
    created_at: datetime
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    job_title: Optional[str] = None
    industry: Optional[str] = None

    class Config:
        from_attributes = True
