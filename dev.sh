#!/bin/bash
# vinext needs Node 22+ (fs/promises glob); the system node here is 20.
export PATH="/opt/homebrew/opt/node@23/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
exec npm run dev -- -p 3010
