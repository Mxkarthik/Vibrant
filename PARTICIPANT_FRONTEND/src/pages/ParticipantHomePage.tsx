export default function ParticipantHomePage() {
  return <main className="home-screen">
    <header className="home-header">
      <a className="home-brand" href="/" aria-label="VIBRANT2K26 home">
        <span className="home-brand-mark">V</span>
        <span>VIBRANT<span className="brand-year">2K26</span></span>
      </a>
      <span className="home-edition">CAMPUS FESTIVAL</span>
    </header>
    <section className="home-hero" aria-labelledby="home-title">
      <p className="home-eyebrow"><span /> THE PARTICIPANT PORTAL</p>
      <h1 id="home-title">One campus.<br /><span>Countless moments.</span></h1>
      <p className="home-description">A place for ideas, talent, and the people who make campus life unforgettable.</p>
      <div className="home-rule"><span />VIBRANT2K26<span /></div>
    </section>
    <section className="home-placeholder" aria-label="Portal status">
      <span className="placeholder-index">01</span>
      <div><p>YOUR FESTIVAL STARTS HERE</p><h2>The experience is taking shape.</h2><span>Participant experiences will appear here soon.</span></div>
      <span className="placeholder-mark" aria-hidden="true">V</span>
    </section>
    <footer className="home-footer"><span>VIBRANT2K26</span><span>ONE CAMPUS. COUNTLESS MOMENTS.</span></footer>
  </main>;
}
