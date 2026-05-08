import "./ErrorBanner.css";

export function ErrorBanner(props: { message: string; onDismiss: () => void }) {
  return (
    <div class="error-banner" role="alert">
      <span class="error-banner-icon">⚠</span>
      <span class="error-banner-message">{props.message}</span>
      <button class="error-banner-dismiss" onClick={props.onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
