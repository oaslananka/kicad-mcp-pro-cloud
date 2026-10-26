import {renderToStaticMarkup} from "react-dom/server";

export type ConsentView =
  | {kind:"notice";message:string}
  | {kind:"approve";clientName:string;scopes:string[];claims?:string;query:string;csrf:string};

export function renderConsentPage(view:ConsentView):string {
  return "<!doctype html>"+renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>KiCad MCP Pro Authorization</title>
      </head>
      <body>
        <main>
          <h1>KiCad MCP Pro Authorization</h1>
          {view.kind==="notice" ? <p>{view.message}</p> : <>
            <p>{view.clientName} requests access to your account.</p>
            <p>Requested permissions:</p>
            <ul>{Array.from(new Set(view.scopes)).map(scope=><li key={scope}>{scope}</li>)}</ul>
            {view.claims ? <p>Additional claims requested: {view.claims}</p> : null}
            <p>This does not automatically authorize access to any KiCad project. Project grants are separate.</p>
            <form action="/consent" method="post">
              <input type="hidden" name="oauth_query" value={view.query}/>
              <input type="hidden" name="csrf" value={view.csrf}/>
              <button name="decision" value="deny" type="submit">Deny</button>
              <button name="decision" value="approve" type="submit">Approve</button>
            </form>
          </>}
        </main>
      </body>
    </html>
  );
}
