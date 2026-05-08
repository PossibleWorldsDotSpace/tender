import "./Preview.css";

export function PreviewIframe(props: { visible: boolean }) {
  return (
    <iframe
      id="preview-iframe"
      src="/_preview"
      class="preview-iframe"
      classList={{ hidden: !props.visible }}
      title="Preview"
    />
  );
}
