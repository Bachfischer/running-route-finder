export function SiteHeader() {
  return (
    <header className="site-masthead">
      <div className="site-masthead-inner">
        <a className="site-title" href="https://bachfischer.me/">
          Matthias Bachfischer Blog
        </a>
        <nav aria-label="Main navigation">
          <a href="https://bachfischer.me/year-archive/">Blog</a>
          <a href="/projects/" aria-current="page">
            Projects
          </a>
          <a href="https://bachfischer.me/publications/">Publications</a>
          <a href="https://bachfischer.me/cv/">CV</a>
          <a href="https://bachfischer.me/reading_list/">Reading List</a>
          <a href="https://bachfischer.me/languages/">Languages</a>
          <a href="https://bachfischer.me/life/">Life</a>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-follow">
          <a href="https://bachfischer.me/sitemap/">Sitemap</a>
        </div>
        <div className="site-footer-copyright">
          © {new Date().getFullYear()} Matthias Bachfischer. A project on{" "}
          <a href="https://bachfischer.me/">bachfischer.me</a>.
        </div>
      </div>
    </footer>
  );
}
