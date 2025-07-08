# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `deno task dev` - Development server with file watching
- `deno task start` - Production server

## Architecture

This is a YouTube WebHub notification checker built for Deno Deploy. The application consists of:

### Core Components

- **main.ts**: Single server file containing Oak router with all API endpoints
- **index.html**: Frontend SPA with vanilla JavaScript

### Data Flow

1. **WebHub Subscription**: `/subscribe` POST endpoint registers with YouTube's PubSubHubbub service
2. **Notification Reception**: `/webhook` endpoint receives XML notifications from YouTube and parses them with regex
3. **Data Storage**: In-memory arrays for notifications and subscriptions (no persistence)
4. **Frontend**: Polls `/api/notifications` and `/api/subscriptions` endpoints every 30 seconds

### Key Implementation Details

- Uses Oak framework for HTTP routing
- WebHub callback URL is dynamically constructed from request origin
- XML parsing is done with simple regex matching (not a full XML parser)
- Notifications are limited to 100 most recent entries
- Subscription leases are set to 5 days (432000 seconds)
- PORT environment variable support for deployment platforms

### API Endpoints

- `POST /subscribe` - Subscribe to YouTube channel WebHub notifications
- `POST /webhook` - Receive WebHub notifications from YouTube
- `GET /webhook` - Handle WebHub challenge verification
- `GET /api/notifications` - Return notification list
- `GET /api/subscriptions` - Return subscription list
- `GET /` - Serve main HTML page

### Deployment

Configured for Deno Deploy with automatic port detection via `PORT` environment variable.