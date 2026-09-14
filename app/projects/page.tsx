import Link from "next/link";
import Image from "next/image";
import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Projects — Matthias Bachfischer" };
export default function Projects() {
  return (
    <>
      <SiteHeader />
      <main className="projects-layout">
        <aside className="author-profile">
          <Image
            unoptimized
            src="/profile.png"
            alt="Matthias Bachfischer"
            width="175"
            height="175"
          />
          <h2>Matthias Bachfischer</h2>
          <p>Head of Data &amp; AI Engineering Chapter | E.ON</p>
          <p>Munich, Germany</p>
          <a href="https://bachfischer.me/">About me</a>
          <a href="https://github.com/Bachfischer">GitHub</a>
        </aside>
        <section className="projects-content">
          <h1>Projects</h1>
          <p>
            Experiments and tools at the intersection of data, engineering, and
            everyday life.
          </p>
          <article className="project-entry">
            <h2>
              <Link href="/">Running route finder</Link>
            </h2>
            <div className="project-meta">
              Interactive tool · September 2026
            </div>
            <p>
              A small tool for a familiar running question: where can I go for a
              loop of roughly the right distance? Pick a starting point, choose
              how far you want to run, and explore a direction. The tool
              compares loops on OpenStreetMap paths and brings you back to the
              start.
            </p>
            <div className="project-tags">
              <span>OpenStreetMap</span>
              <span>Graph search</span>
              <span>Cloudflare Workers</span>
            </div>
            <Link className="project-launch" href="/">
              Launch route finder
            </Link>
            <div className="project-method">
              <h3>How it works</h3>
              <p>
                Nearby streets and trails become a walkable graph. A* search
                connects candidate waypoints into loops, ranked by distance
                accuracy, direction, and backtracking. Choose a route and
                download the GPX file for your run.
              </p>
            </div>
          </article>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
