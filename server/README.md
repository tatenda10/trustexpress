# Trust Express API

Node.js + Express + MySQL. No `src` folder: use `db/`, `middleware/`, `routes/` at server root.

## Setup

1. `cd server && npm install`
2. Copy `.env.example` to `.env` (set `CLERK_SECRET_KEY`, `DB_*`, `PORT`)
3. Create DB: `mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS trust_express;"`
4. Run schema: `mysql -u root -p trust_express < sql/schema.sql`
5. `npm run dev` → API at http://localhost:3001

## Routes

- `GET /api/health` – health check
- `GET /api/users/me` – current user (auth required)
- `POST /api/users/register` – body: `{ role, email? }` (auth required)

**Drivers (Option A – sequential docs → car → go online)**

- `GET /api/drivers/me` – driver profile + vehicle status (auth, driver only)
- `POST /api/drivers/documents` – Phase 1: submit identity docs (national ID front/back, licence, selfie) – body: `{ nationalIdFrontUrl, nationalIdBackUrl, driverLicenceUrl, selfieUrl }`
- `POST /api/drivers/vehicle` – Phase 2: register car (after profile approved) – body: car photos, numberPlate, make, model, year, color, vehicleRegistrationUrl, insuranceUrl
- `PATCH /api/drivers/profile/status` – admin: body `{ profileId, status: 'approved'|'rejected', rejectionReason? }`
- `PATCH /api/drivers/vehicle/status` – admin: body `{ vehicleId, status: 'approved'|'rejected', rejectionReason? }`

**Upload**

- `POST /api/upload` – multipart `file` – returns `{ url: '/uploads/...' }` (auth required). Serve at `GET /uploads/:filename`.

Send `Authorization: Bearer <Clerk session token>` for protected routes.

## DB schema (summary)

- **users** – clerk_user_id, email, role (passenger | driver)
- **driver_profiles** – Phase 1: national_id_front_url, national_id_back_url, driver_licence_url, selfie_url, status (pending | approved | rejected), rejection_reason
- **vehicles** – Phase 2: car_photo_front_url, car_photo_rear_url, number_plate, make, model, year, color, vehicle_registration_url, insurance_url, status, rejection_reason
