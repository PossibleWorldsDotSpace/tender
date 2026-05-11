import "./Preview.css";

export function PreviewIframe(props: { visible: boolean; doc: string | null }) {
  // src changes when doc changes → browser reloads with the new doc.
  const src = () => props.doc ? `/_preview?doc=${encodeURIComponent(props.doc)}` : "/_preview";
  return (
    <iframe
      id="preview-iframe"
      src={src()}
      class="preview-iframe"
      classList={{ hidden: !props.visible }}
      title="Preview"
    />
  );
}
