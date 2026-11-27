<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway jQuery CDN Demo

A single HTML page that loads jQuery from `code.jquery.com` and [`@tracewayapp/jquery`](https://www.npmjs.com/package/@tracewayapp/jquery) from jsDelivr (`@tracewayapp/jquery@2/dist/traceway-jquery.iife.global.js`), with no bundler and nothing to install. It starts the SDK with `TracewayJQuery.init({ token: "YOUR_TOKEN" })` and has three buttons:

| Button | What happens |
|--------|--------------|
| Failing $.ajax (HTTP 500) | `$.ajax` to `https://httpbin.org/status/500`. The package's `ajaxError` handler reports it as an exception, `GET https://httpbin.org/status/500 failed: 500 …`, with `url`, `method` and `status` attributes |
| recordAction() | `TracewayJQuery.recordAction("demo", "button_clicked", …)`, a breadcrumb that is kept on the device and uploaded with the next error |
| Flush | `TracewayJQuery.flush()` sends what is queued |

The page also has a line with `class="traceway-mask"`, which the replay shows as `*`.

## Run it

Replace `YOUR_TOKEN` in `index.html` with your project token. The page sends to Traceway Cloud; for a self-hosted server, add its address as `baseUrl` next to the token. Then serve this directory with any static server and open the page, for example:

```bash
cd packages/jquery/examples/jquery-cdn
npx serve .
```

The `init({ token })` call needs `@tracewayapp/jquery` 2.1.0 or later, which `@2` on jsDelivr resolves to once it is published. The SDK starts with `debug: true`, so the console shows what it sends, drops and why.

## Links

- [jQuery SDK](https://www.npmjs.com/package/@tracewayapp/jquery)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [jQuery guide](https://docs.tracewayapp.com/client/jquery)
- [Traceway Website](https://tracewayapp.com)
