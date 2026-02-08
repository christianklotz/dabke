FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Sync dependencies only (skip local package since src/ doesn't exist yet)
RUN uv sync --frozen --no-dev --no-install-project

# Copy application source
COPY src/ ./src/

# Install the local package now that source exists
RUN uv sync --frozen --no-dev

# Use the venv
ENV PATH="/app/.venv/bin:$PATH"

# Server configuration
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

CMD ["sh", "-c", "exec uvicorn solver.app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
