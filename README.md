
# Radiology AI Backend (Simple Demo - No S3)

This repository contains a simple Node.js + Express backend to run a radiology AI prototype.
It accepts image uploads, performs a mock (or real, if you add an API key) vision/LLM call,
and returns findings + a draft radiology report.

## Files included
- `server.js` - main Express server
- `package.json`
- `.env.example`
- `uploads/` - sample uploads folder (dev only)

## Quickstart (local)
1. Install dependencies:
```bash
npm install
```
2. Copy `.env.example` to `.env` and optionally set `OPENAI_API_KEY`. If you leave the key empty,
   the server returns a mock analysis suitable for demos.

3. Start the server:
```bash
node server.js
```

4. Test with the included sample image (the original uploaded file is referenced below).
   Replace the file path if needed.

Example curl using the uploaded sample image path (this path exists in this environment):
```bash
curl -X POST "http://localhost:3000/analyze" \
  -F "image=@/mnt/data/A_digital_image_features_bold,_white,_capitalized_.png" \
  -F "patientName=Demo Patient" \
  -F "age=45" \
  -F "sex=M" \
  -F "notes=chronic cough for 2 weeks"
```

> **Note:** On hosted platforms like Render, the `uploads/` folder is ephemeral. This demo is intended for local testing.
> For production, integrate S3 or another cloud storage provider.

## Deploy to Render
1. Push this repo to GitHub.
2. Create a new Web Service on Render and connect your GitHub repo.
3. Set the Build Command to `npm install` and Start Command to `npm start`.
4. Add environment variables on Render:
```
OPENAI_API_KEY=
VISION_MODEL=gpt-4o-mini-vision
PORT=3000
```

The server will run in mock mode if `OPENAI_API_KEY` is empty.

## Next steps (recommended)
- Replace mock AI call with a real vision LLM (OpenAI, Azure, Anthropic).
- Add secure S3 upload for images (recommended before real patient data).
- Add clinician authentication & review UI.
- Add audit logging and retention policies for PHI.

