# Getting Started

## 1. Install Dependencies

```bash
npm install
```

## 2. Generate Prisma Client

```bash
npx prisma generate
```

## 3. Run Database Migrations

```bash
npx prisma migrate dev
```

## 4. Start the Express Server

```bash
npm run dev
```

## Notes

- Make sure your `schema.prisma` is configured correctly.
- Update your `.env` file with the correct database connection string.
- For production, use `npm run build` and `npm start`.