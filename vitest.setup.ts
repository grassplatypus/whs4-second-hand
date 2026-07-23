import "@testing-library/jest-dom/vitest";

process.env.DATABASE_URL ??= "postgresql://app:app@localhost:5432/app";
process.env.JWT_ACCESS_SECRET ??= "test_access_secret_at_least_16";
process.env.JWT_REFRESH_SECRET ??= "test_refresh_secret_at_least_16";
process.env.AES_KEY ??= "0123456789abcdef0123456789abcdef";
process.env.BLIND_INDEX_KEY ??= "0123456789abcdef0123456789abcdef";
process.env.WS_PORT ??= "4000";
