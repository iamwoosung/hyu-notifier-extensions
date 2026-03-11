@echo off
cd /d "%~dp0.."
set COMPOSE_ENV_FILE=pkg.env.production
docker compose up -d
