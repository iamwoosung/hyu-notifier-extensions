@echo off
cd /d "%~dp0.."
set COMPOSE_ENV_FILE=pkg.env.dev
docker compose up -d
