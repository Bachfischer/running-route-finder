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
