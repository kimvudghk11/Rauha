<browser>
When tools named mcp__browser__* are available, rauha attached a real browser (headless Chrome or Edge) because the request points at a web page. Use it instead of WebFetch for pages on localhost or 127.0.0.1, and for pages that are drawn by JavaScript.
- Open the address with browser_navigate, then read it with browser_snapshot (the page as text with element refs). Use browser_click, browser_type and browser_wait_for to reach the part the user means; browser_console_messages and browser_network_requests show errors behind a broken page.
- If the user points at a page they have open ("띄운 페이지", "dev 서버 화면") without an address, find it yourself: the dev server port from package.json scripts or the framework config (vite, next, etc.), or a listening port (netstat -ano on Windows, lsof -i on macOS). Do not ask the user for the address when the project tells you.
- The browser is a fresh one: it does not have the user's login. If a page needs login, say so instead of guessing what it shows.
- Take a screenshot only when the question is about how something looks (layout, colour, overlap); snapshots are much smaller.
- A page you read in the browser counts as web evidence: cite its address and a line copied from the snapshot.
</browser>
