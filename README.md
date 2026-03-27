# Carmaa Billing

This project is an expense management and billing system with a frontend, backend, and Vercel-compatible serverless API.

## Project Structure

- `billing-backend/`: Express.js backend with Mongoose/MongoDB.
- `billing-frontend/`: React-based frontend.
- `api/`: Vercel serverless functions entry point.

## Initial Setup & Seeding

Before you can log in, you must seed the database with an initial admin user.

### Local Seeding
1.  Navigate to the `billing-backend` directory.
2.  Ensure you have a `.env` file with `MONGODB_URI` set.
3.  Run the following command:
    ```bash
    npm run seed:admin
    ```

### Vercel Seeding
Once your project is deployed to Vercel, you can trigger the initial seeding by sending a **POST** request to the seeding endpoint:
```bash
curl -X POST https://your-vercel-domain.vercel.app/api/v1/auth/seed
```
*Note: This will only work if the database is currently empty.*

## Default Admin Credentials

- **Super Admin**: `admin` / `admin123`
- **Read-Only Admin**: `readonly` / `admin123`

> [!IMPORTANT]
> For security, please change these default passwords immediately after your first login.