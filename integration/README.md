# Suggested integration with bachfischer.me

Prepared against the website's main HEAD `738c885f495c416196aaf97be4666cb74d3f4580`. These are reviewable additions only: the original GitHub repository has not been changed or published.

## Recommended structure

- `bachfischer.me/projects/`: project index with the existing author sidebar and archive-list styling.
- `bachfischer.me/projects/running-routes/`: normal Jekyll project article, with explanation, limitations, and a launch button.
- `run.bachfischer.me`: proposed independent Cloudflare Worker custom domain for the live tool, with the same masthead, font stack, gray palette, and cyan accents. This domain is a proposal, not an active deployment.

Your `_config.yml` already declares an output-enabled `portfolio` collection with a `single` layout default. This proposal reuses it and overrides this entry's permalink. There is no extra Jekyll plugin, theme change, or new collection. Projects is inserted after Blog in `_data/navigation.yml`; all other entries stay in place. A separate Worker keeps the current GitHub Pages build intact.

The app's `/projects/` page provides a working visual example of the new index. The app home is the route finder. The standalone masthead links Blog, Publications, CV, Reading List, Languages, and Life back to their current website URLs.

## Website changes

From a clean checkout of your website:

```sh
git apply --check /path/to/website-projects.patch
git apply /path/to/website-projects.patch
```

The patch adds the Projects navigation item, the index, the portfolio entry, and an empty `running_routes_url` setting. After independently deploying the Worker, set that value in `_config.yml` to its actual HTTPS address. The launch button is hidden until a URL is configured. Run your existing Jekyll build, review, and publish through your normal GitHub Pages flow. If the website has changed since the source revision above, inspect the patch before applying it.

Deploy the independent Worker using the main README. To add `run.bachfischer.me`, your domain must be available in your Cloudflare account; add a Workers Custom Domain after deployment. Until then, the Worker-provided URL works. Update the app's Projects navigation link to `https://bachfischer.me/projects/` after the Jekyll page is live if you prefer the canonical blog index.

## Optional inline embed

The main recommendation is a project page plus launch button. If you prefer to keep the tool inside the article, the app also supports `?embed=1`: this omits the duplicate masthead, page introduction, and footer.

After configuring the public Worker URL, this can be added to the portfolio page:

```html
{% if site.running_routes_url and site.running_routes_url != "" %}
<iframe
  src="{{ site.running_routes_url | escape }}?embed=1"
  title="Running route finder"
  width="100%"
  height="1300"
  style="border: 1px solid #f2f3f3; border-radius: 4px;"
  loading="lazy"
  allow="geolocation">
</iframe>
<p><a href="{{ site.running_routes_url | escape }}">Open the route finder in a full window</a></p>
{% endif %}
```

The existing `single` layout constrains article width, even with `author_profile: false`. Use the launch button for the best map space, or a dedicated full-width layout if you want a wide embedded map. A private Sites URL is not a suitable public embed. Cross-origin geolocation also depends on the parent's Permissions-Policy; manual location search and map pinning remain available. A fixed iframe height is intentionally used here: no insecure cross-origin message handler or automatic resizing is introduced.

## Theme mapping

The app adopts the exact system-font stack and 4px corner radius from `_sass/_variables.scss`, white background, `#494e52` text, `#7a8288` gray, `#f2f3f3` separators, and the site's `#52adc8` cyan accent. Text links use a slightly darker cyan (`#39829a`) to improve readability at small sizes. The Projects example reuses your existing profile image. No new font download or profile-image generation is needed.

## Verification

The patch was checked with `git apply --check` against the referenced source revision. The Jekyll build was not run here; run it in your existing repository workflow before publishing. The updated app passes TypeScript compilation and its production build.
