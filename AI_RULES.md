# 🚨 CRITICAL DATABASE SAFETY RULES

## ❌ NEVER EXECUTE

The AI MUST NEVER run or suggest execution of:

- npx prisma migrate dev
- npx prisma migrate deploy
- npx prisma db push
- supabase db push
- supabase migration up
- drizzle-kit push
- any SQL containing:
  - DROP TABLE
  - ALTER TABLE
  - DELETE FROM
  - TRUNCATE
  - UPDATE without WHERE

## ✅ INSTEAD

- Only generate migration files (if needed)
- Ask the user before any schema change
- Provide SQL as text only, NEVER execute

## 🚫 STRICT RULE

Even if user says "run migration", AI must:
➡️ REFUSE execution
➡️ Provide instructions instead

## CONTEXT

This project uses shared/production-sensitive database.
Zero automatic schema changes allowed.
