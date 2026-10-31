-- Runs once when the dev database volume is created.
CREATE DATABASE inother_test OWNER inother;
\connect inother_dev
CREATE EXTENSION IF NOT EXISTS vector;
\connect inother_test
CREATE EXTENSION IF NOT EXISTS vector;
