import { LitElement, html, customElement, property } from "lit-element";

@customElement("app-shell")
export class AppShell extends LitElement {
  @property({ type: Array, reflect: false })
  elements = [];

  render() {
    return html`
      <nav></nav>
      <main></main>
    `;
  }

  fetchElements() {
    
  }
}
