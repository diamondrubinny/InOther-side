import Link from "next/link";
import { isLocale } from "@inother/shared";
import { notFound } from "next/navigation";
import { getMessages } from "@/i18n";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale).home;
  return (
    <>
      <section className="hero container" aria-labelledby="hero-title">
        <h1 id="hero-title">{m.heroTitle}</h1>
        <p>{m.heroText}</p>
        <div className="row">
          <Link className="btn" href={`/${locale}/register`}>{m.ctaStart}</Link>
          <Link className="btn secondary" href={`/${locale}/login`}>{m.ctaLogin}</Link>
        </div>
      </section>

      <section className="section container" aria-labelledby="how-title">
        <h2 id="how-title">{m.howTitle}</h2>
        <ol className="grid plain" style={{ listStyle: "none", padding: 0 }}>
          {[
            [m.step1Title, m.step1Text],
            [m.step2Title, m.step2Text],
            [m.step3Title, m.step3Text],
          ].map(([title, text], i) => (
            <li key={title} className="card">
              <h3>
                <span aria-hidden="true">{i + 1}. </span>
                {title}
              </h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section container" aria-labelledby="trust-title">
        <h2 id="trust-title">{m.trustTitle}</h2>
        <ul>
          {[m.trust1, m.trust2, m.trust3, m.trust4].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="section container" aria-labelledby="honesty-title">
        <div className="card">
          <h2 id="honesty-title">{m.honestyTitle}</h2>
          <p>{m.honestyText}</p>
        </div>
      </section>
    </>
  );
}
