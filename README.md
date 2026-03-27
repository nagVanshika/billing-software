# Carmaa Billing

This project is an expense management and billing system with a frontend, backend, and Vercel-compatible serverless API.

---

## 🚀 Quick Start (Local Setup)

Follow these steps to get the project running on your local machine.

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [MongoDB](https://www.mongodb.com/try/download/community) (running locally or a cloud URI)

### 1. Backend Setup
1.  Navigate to the `billing-backend` directory:
    ```bash
    cd billing-backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your environment:
    - Copy `.env.example` to `.env`:
      ```bash
      cp .env.example .env
      ```
    - Edit `.env` and provide your `MONGODB_URI` and `JWT_SECRET`.
4.  Seed the database (Required for first login):
    ```bash
    npm run seed:admin
    ```
5.  Start the backend in development mode:
    ```bash
    npm run dev
    ```
    *The server will run at `http://localhost:5001`.*

### 2. Frontend Setup
1.  Navigate to the `billing-frontend` directory:
    ```bash
    cd billing-frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the frontend in development mode:
    ```bash
    npm run dev
    ```
    *The app will run at `http://localhost:5173`.*

---

## 🛠 Project Structure

- `billing-backend/`: Express.js backend with Mongoose/MongoDB.
- `billing-frontend/`: React-based frontend using Vite.
- `api/`: Vercel serverless functions entry point.

---

## 🔑 Authentication & Seeding

### Initial Admin Credentials
- **Super Admin**: `superadmin` / `password123`
- **Read-Only Admin**: `readonly` / `password123`

### Seeding in Production
Once deployed to Vercel, trigger initial seeding via:
```bash
curl -X POST https://your-vercel-domain.vercel.app/api/v1/auth/seed
```
*Note: This will only work if the database is empty.*

---

## 🌩 Vercel Deployment

This project is optimized for Vercel. 
- Ensure all environment variables from `.env.example` are added to your Vercel project settings.
- The root `package.json` handles the build process for deployment.

> [!IMPORTANT]
> For security, please change default passwords immediately after your first login.