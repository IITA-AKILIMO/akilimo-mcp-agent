# Weather MCP server (https://github.com/isdaniel/mcp_weather_server): current weather, forecasts,
# air quality and time zones from the free Open-Meteo API; no API key needed.
# Served as stateless streamable HTTP at :8080/mcp; register it in the web UI (Manage) as
# http://weather-mcp:8080/mcp.
FROM python:3.12-slim

# Pinned for reproducible builds. mcp_weather_server 0.6.1 does not cap the mcp SDK and fails to
# start with mcp 2.x (cannot import name 'McpError'), so the SDK is pinned to the 1.x line too.
ARG MCP_WEATHER_SERVER_VERSION=0.6.1
ARG MCP_SDK_VERSION=1.30.0
RUN pip install --no-cache-dir \
    "mcp_weather_server==${MCP_WEATHER_SERVER_VERSION}" \
    "mcp[cli]==${MCP_SDK_VERSION}"

RUN useradd --create-home --uid 10001 mcp
USER mcp

EXPOSE 8080

# The server has no health route; check that it accepts connections
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import socket; socket.create_connection(('127.0.0.1', 8080), 3).close()" || exit 1

CMD ["python", "-m", "mcp_weather_server", "--mode", "streamable-http", "--stateless", "--host", "0.0.0.0", "--port", "8080"]
