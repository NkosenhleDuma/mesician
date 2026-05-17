# HTTP API (Next.js Route Handlers)

All routes expect JSON unless noted. Authenticated routes use the `mesician_session` HTTP-only cookie (JWT).

## Auth

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{ email, password }` | `{ user: { id, email } }` + sets cookie |
| POST | `/api/auth/login` | `{ email, password }` | `{ user: { id, email } }` + sets cookie |
| POST | `/api/auth/logout` | — | `{ ok: true }`, clears cookie |

## Songs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/songs` | Lists current user’s songs |
| POST | `/api/songs` | `{ title, artist? }` → `{ song }` |
| DELETE | `/api/songs/:id` | Deletes the song, cascades DB rows, removes all objects under `songs/:id/` in MinIO |
| DELETE | `/api/songs/:id/ingestion` | Keeps the song row; deletes tracks, upload rows, and all `songs/:id/` objects in MinIO |

## Upload & tracks

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/songs/:id/upload` | `multipart/form-data` field **`file`** (`.gp`, `.gp3`, `.gp4`, `.gp5`, or `.gpx`). Parses GP, writes MinIO, rebuilds tracks, and recomputes difficulty. **Re-upload** after parser timing fixes to refresh stored charts (see [troubleshooting](troubleshooting.md)). |
| GET | `/api/songs/:id/tracks` | Track metadata |

## Charts

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/songs/:id/tracks/:trackId/chart` | Returns the stored practice chart for the track |
| GET | `/api/songs/:id/tracks/:trackId/chart-source` | `{ chart }` effective source |
| PUT | `/api/songs/:id/tracks/:trackId/chart-source` | Full `chart.json` body (or `{ chart }`). Triggers merge + difficulty recomputation |

## Errors

- `400` — validation / missing fields  
- `401` — not authenticated  
- `403` — wrong user  
- `404` — unknown resource  
- `409` — signup conflict (email taken)  
