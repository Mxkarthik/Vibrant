export default function BackgroundGrid() {
  return (
    <div className="vibrant-bg-grid" aria-hidden="true">
      <div className="vibrant-grid-lines" />
      <div className="vibrant-grid-crosses">
        <span className="cross-mark cross-top-left">+</span>
        <span className="cross-mark cross-top-right">+</span>
        <span className="cross-mark cross-mid-left">+</span>
        <span className="cross-mark cross-mid-right">+</span>
        <span className="cross-mark cross-bottom-left">+</span>
        <span className="cross-mark cross-bottom-right">+</span>
      </div>
      <div className="vibrant-grid-mask" />
    </div>
  );
}
