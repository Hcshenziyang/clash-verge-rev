# Custom unlock tests

On the Unlock Test page, use **Add custom test** to create an editable check.
Each check makes a GET request through Clash's current routing rules and matches
all configured conditions:

- The HTTP status must equal the expected status.
- If response text is specified, the response body must contain that text.
- If a region regex is specified, the response body must match it. The first
  capture group is displayed as the region, or the whole match if there is no
  capture group. The regex uses Rust's `regex` syntax.

Requests do not follow redirects, time out after 15 seconds, and read at most
2 MiB of response data. TLS verifies the URL's hostname even when the optional
HTTP Host header is overridden. Definitions and the most recent results are
stored locally in the app. Avoid including secrets in URLs: definitions are
not encrypted.

**Rule matched** only means these response conditions matched. A mismatch,
network error, or a matched rule does not by itself prove whether a service is
available in a particular region. Checks do not send authentication headers or
POST bodies; an authenticated API needs its own real request to verify access.

The two included Antigravity examples connect to each API hostname while
requesting Google's public Terms page with the HTTP Host override. Their country
is an estimate from that page, not an authenticated response from either API.
Changing the selected node or routing rules requires running the checks again.
