import { renderToStaticMarkup } from "react-dom/server";

export type DisplayConnection = {
  id: string;
  name: string;
  scopes: string[];
  clientId: string;
  csrf: string;
};
export function renderConnectionsPage(connections:DisplayConnection[], notice?:string):string {
  return "<!doctype html>" + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Connected AI clients — KiCad MCP Pro</title>
      </head>
      <body>
        <main>
          <h1>Connected AI clients</h1>
          <p>Removing access disables all project grants for the client. Already issued JWTs may remain valid until expiry, but disabled project grants prevent Cloud project discovery.</p>
          {notice ? <p role="status">{notice}</p> : null}
          {connections.length===0 ? <p>No active OAuth consents.</p> :
            <ul>{connections.map(c=>
              <li key={c.id}>
                <h2>{c.name}</h2>
                <p>Requested scopes: {c.scopes.join(", ")}</p>
                <form method="post" action="/connections/revoke">
                  <input type="hidden" name="id" value={c.id}/>
                  <input type="hidden" name="client_id" value={c.clientId}/>
                  <input type="hidden" name="csrf" value={c.csrf}/>
                  <button type="submit">Remove access</button>
                </form>
              </li>
            )}</ul>}
          <a href="/account">Back to account</a>
        </main>
      </body>
    </html>
  );
}
