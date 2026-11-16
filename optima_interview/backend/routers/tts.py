import logging
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import auth as auth_utils
import models

router = APIRouter(prefix="/tts", tags=["tts"])
log = logging.getLogger("optima")

# An interview question is a few sentences. Anything much longer is not one.
MAX_SPOKEN_CHARS = 1500


class SpeakRequest(BaseModel):
    text: str


@router.post("/speak")
def speak(
    payload: SpeakRequest,
    # each call is paid for, so only someone signed in may ask for one
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="TTS service not configured")

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    text = text[:MAX_SPOKEN_CHARS]

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, timeout=30.0)
        response = client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=text,
        )
        audio_bytes = response.content
    except Exception:
        log.exception("Reading a question aloud failed")
        raise HTTPException(status_code=502, detail="The question could not be read aloud just now.")

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )
