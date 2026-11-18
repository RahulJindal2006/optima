// What has to be true before an interview begins, where the camera and microphone are a condition of it.
import { TIP_TEXT } from './tips.js'

// The last line of the checklist: does the microphone hear a voice.
// In a weekly interview (`required`) the microphone has to be allowed, and where it can be heard, heard.
export function soundCheck(mic, sound, required) {
  if (mic === 'blocked') {
    return { state: required ? 'no' : 'unknown', label: 'The microphone is blocked', note: required ? 'Allow it from the address bar, then check again.' : 'Allow it from the address bar to get voice tips.' }
  }
  if (mic === 'words') return { state: required ? 'yes' : 'unknown', label: required ? 'The microphone is allowed' : 'Voice tips come from dictation here', note: required ? null : 'Pace and filler words, when you answer aloud.' }
  if (mic !== 'on') {
    return { state: required ? 'no' : 'unknown', label: 'No microphone to listen with', note: required ? 'Plug one in or switch it on, then check again.' : 'The coach will watch, but cannot hear your voice.' }
  }
  if (!sound.heard) return { state: 'unknown', label: 'Say a few words to test the microphone' }
  if (sound.problem) return { state: required ? 'yes' : 'no', label: 'The microphone hears you', note: TIP_TEXT[sound.problem][0] }
  return { state: 'yes', label: 'The microphone hears you' }
}

// True when a weekly interview may begin: the picture is right and the microphone is allowed and heard.
export function coachReady({ status, mic, sound, pictureOk }) {
  return status === 'on' && Boolean(pictureOk) && soundCheck(mic, sound || { heard: false, problem: null }, true).state === 'yes'
}
