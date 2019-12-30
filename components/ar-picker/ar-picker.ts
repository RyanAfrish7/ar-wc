import { LitElement, html, customElement, property } from "lit-element";
import { repeat } from "lit-html/directives/repeat";
import bezier from "bezier-easing";

import style from "./ar-picker-css";

const ITEM_HEIGHT = 24;
const EFFECTIVELY_ZERO = 1e-10;

const approxEq = (value1: number, value2: number, delta = EFFECTIVELY_ZERO) => Math.abs(value1 - value2) <= delta;

type ItemType = string;

/**
 * `<ar-picker>` is a minimal cupertino style picker which allows user to pick
 * an item from the list.
 *
 */
@customElement("ar-picker")
export class Picker extends LitElement {
    private pendingScroll = 0;
    private currentScroll = 0;
    private isExternalForceActive = false;

    private easingFunction: any;
    private inverseEasingFunction: any;
    private selectedItem: any;
    private animating: number | null = null;
    private lastTimestamp: number | null = null;
    private trackedTouch: Touch | null = null;
    private debounceTimer: number | null = null;

    /**
     * Time taken (in milliseconds) for scrolling between two stable positions.
     * This may get shrunken down when scrolled with higher energies.
     */
    @property({ type: Number, hasChanged: () => false })
    animationDuration = 180;

    /**
     * List of items to be displayed in the wheel
     */
    @property({ type: Array })
    items: ItemType[] = [];

    constructor() {
        super();
        this.initEasingFunctions(0.785, 0.135, 0.15, 0.86);
        this.animatePhysics = this.animatePhysics.bind(this);
    }

    /**
     * (x1, y1) and (x2, y2) are control points which forms convex hull of the curve.
     */
    private initEasingFunctions(x1: number, y1: number, x2: number, y2: number) {
        this.easingFunction = bezier(x1, y1, x2, y2);
        this.inverseEasingFunction = bezier(y1, x1, y2, x2);
    }

    get _selectedIndex() {
        return Math.round(this.currentScroll / ITEM_HEIGHT);
    }

    renderStyle() {
        return style;
    }

    render() {
        return html`
            ${this.renderStyle()}
            <style>
                :host {
                    display: block;
                    position: relative;
                    touch-action: none;
                    --item-height: ${ITEM_HEIGHT}px;
                }

                #container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    overflow-x: hidden;
                    overflow-y: hidden;
                    -webkit-font-smoothing: antialiased;
                }

                #container .whitespace {
                    height: calc(50% - var(--item-height) / 2);
                    flex-shrink: 0;
                }

                #selection-marker {
                    pointer-events: none;
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 100%;
                }

                #selection-marker hr {
                    margin: 0;
                }

                #wheel {
                    height: 100%;
                }

                .item {
                    box-sizing: border-box;
                    min-height: var(--item-height);
                    height: var(--item-height);
                }
            </style>
            <div id="container"
                @wheel=${{ handleEvent: this.onWheelHandler.bind(this), passive: true }} 
                @touchstart=${{ handleEvent: this.onTouchStart.bind(this), passive: true }}
                @touchend=${{ handleEvent: this.onTouchEnd.bind(this), passive: true }}
                @touchmove=${{ handleEvent: this.onTouchMove.bind(this), passive: true }}
                @keydown=${{ handleEvent: this.onKeyDown.bind(this), passive: true }}
                tabindex="-1">
                <div id="wheel">
                    <div class="whitespace start"></div>
                    ${repeat(this.items, this.renderItem.bind(this))}
                    <div class="whitespace end"></div>
                </div>
            </div>
            <div id="selection-marker">
                <slot name="selection-marker">
                    <hr />
                    <div style="height: calc(var(--item-height) * 1.4)"></div>
                    <hr />
                </slot>
            </div>
        `;
    }

    renderItem(item: ItemType) {
        return html`<div class="item" @click=${this.onItemClick} data-value="${item}">${item}</div>`;
    }

    updated() {
        this.applyPhysics();
    }

    private stopAnimation() {
        this.pendingScroll = 0;
        this.lastTimestamp = null;

        if (this.animating) {
            cancelAnimationFrame(this.animating);
            this.animating = null;
        }

        return this.animating;
    }

    private startPhysicsAnimation() {
        if (!this.animating) {
            requestAnimationFrame(this.animatePhysics);
        }
    }

    private animatePhysics(now: number) {
        if (!this.lastTimestamp) {
            // setup timestamp and wait until next frame
            this.lastTimestamp = now;
            this.animating = requestAnimationFrame(this.animatePhysics);

            return this.animating;
        }

        // sentinel checks
        if ((this.currentScroll === 0 && this.pendingScroll < 0)
            || (this.currentScroll >= ITEM_HEIGHT * (this.items.length - 1)
                && this.pendingScroll > 0)) {
            // hard absorption of any remaining force. TODO momentum scrolling
            this.pendingScroll = 0;
        }

        // stability check
        if (approxEq(this.pendingScroll, 0)) {
            if (this.isWheelStable()) {
                return this.onWheelStable();
            }
            this.stabilizeWheel();
            this.lastTimestamp = now;
            this.animating = requestAnimationFrame(this.animatePhysics);

            return this.animating;
        }

        const delta = now - this.lastTimestamp;

        // Measures the offset distance from previous stable position.
        const scrollOffset = this.pendingScroll > 0
            ? (ITEM_HEIGHT + this.currentScroll) % ITEM_HEIGHT
            : (ITEM_HEIGHT - (this.currentScroll % ITEM_HEIGHT)) % ITEM_HEIGHT;

        // defense mechanism
        if (scrollOffset < 0) {
            console.debug('Error context: ', {
                scrollOffset,
                pendingScroll: this.pendingScroll,
                currentScroll: this.currentScroll,
                delta,
                lastTimestamp: this.lastTimestamp,
                now,
            });
            throw new RangeError("Not supposed to happen. One of the sentinel checks should have catched this.", );
        }

        // shrink animation time based on force applied
        const shrunkenAnimationTime = Math.min(
            this.animationDuration,
            this.animationDuration * ITEM_HEIGHT / Math.abs(this.pendingScroll),
        );

        // estimate time taken for scroll offset
        const t = this.inverseEasingFunction(scrollOffset / ITEM_HEIGHT) * shrunkenAnimationTime;

        // differential distance for given delta
        let dx = this.easingFunction(Math.min(1, (t + delta) / shrunkenAnimationTime)) * ITEM_HEIGHT
            - this.easingFunction(Math.min(1, t / shrunkenAnimationTime)) * ITEM_HEIGHT;

        // apply maximum limits
        dx = Math.sign(this.pendingScroll) * Math.min(Math.abs(this.pendingScroll), dx);

        // animate scroll
        this.currentScroll = Math.max(
            0,
            Math.min(ITEM_HEIGHT * this.items.length, this.currentScroll + dx),
        );
        if (approxEq(this.currentScroll, Math.round(this.currentScroll))) {
            this.currentScroll = Math.round(this.currentScroll);
        }

        this.applyPhysics();

        // compute animation params for next frame
        this.pendingScroll -= dx;
        this.lastTimestamp = now;

        this.animating = requestAnimationFrame(this.animatePhysics);

        return this.animating;
    }

    private applyPhysics() {
        const container = this.shadowRoot!.querySelector<HTMLElement>("#container");

        this.shadowRoot?.querySelectorAll<HTMLElement>("#container .item").forEach((item, i) => {
            let angle = 0;
            let dy = -this.currentScroll;
            let scale = 1;

            if (Math.abs(i * ITEM_HEIGHT - this.currentScroll) < container!.offsetHeight / 2) {
                angle = (i * ITEM_HEIGHT - this.currentScroll) / (container!.offsetHeight / 2)
                    * Math.PI / 2;
                dy = (container!.offsetHeight / 2) * Math.sin(angle) - i * ITEM_HEIGHT;
                scale = 1 + 0.4 * (1 - Math.abs(angle / Math.PI * 2));

                item.classList.toggle("selected", Math.abs(i * ITEM_HEIGHT - this.currentScroll) < ITEM_HEIGHT / 2);
            }

            if (i * ITEM_HEIGHT - this.currentScroll >= container!.offsetHeight / 2) {
                dy += ITEM_HEIGHT;
            }

            if (this.currentScroll - i * ITEM_HEIGHT >= container!.offsetHeight / 2) {
                dy -= ITEM_HEIGHT;
            }

            item.style.transform = `translateY(${dy}px) rotateX(${angle}rad) scale(${scale})`;
        });
    }

    private isWheelStable() {
        if (approxEq(this.pendingScroll, 0)) {
            this.pendingScroll = 0;

            return approxEq(this.currentScroll % ITEM_HEIGHT, 0) // is current position stable
                || this.isExternalForceActive;
        }

        return false;
    }

    private onWheelStable() {
        const selectedIndex = this._selectedIndex;

        if (!this.isExternalForceActive && this.selectedItem !== this.items[selectedIndex]) {
            this.selectedItem = this.items[selectedIndex];

            this.dispatchEvent(new CustomEvent("select", {
                detail: { selected: this.selectedItem },
            }));
        }

        return this.stopAnimation();
    }

    private stabilizeWheel() {
        if (this.currentScroll % ITEM_HEIGHT > ITEM_HEIGHT / 2) {
            this.pendingScroll = ITEM_HEIGHT - (this.currentScroll % ITEM_HEIGHT);
        } else {
            this.pendingScroll = -(this.currentScroll % ITEM_HEIGHT);
        }

        this.startPhysicsAnimation();
    }

    private onItemClick(event: MouseEvent) {
        const whitespaceElement = this.shadowRoot!.querySelector<HTMLElement>(".whitespace.start");
        const clickedItem = (event.composedPath()[0] as HTMLElement).closest<HTMLElement>("div.item");

        this.pendingScroll += clickedItem!.offsetTop
        - (this.currentScroll + whitespaceElement!.offsetTop + whitespaceElement!.offsetHeight);
        this.startPhysicsAnimation();

        this.dispatchEvent(new CustomEvent("select", {
            detail: {
                selected: clickedItem!.getAttribute("data-value"),
            },
        }));
    }

    private onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowUp") {
            this.pendingScroll -= ITEM_HEIGHT;
            this.startPhysicsAnimation();
        } else if (event.key === "ArrowDown") {
            this.pendingScroll += ITEM_HEIGHT;
            this.startPhysicsAnimation();
        }
    }

    private onTouchStart(event: TouchEvent) {
        if (!this.trackedTouch) {
            [this.trackedTouch] = event.changedTouches;
            this.isExternalForceActive = true;
        }
    }

    private onTouchEnd(event: TouchEvent) {
        if (this.trackedTouch && Array.from(event.changedTouches)
            .find(touch => touch.identifier === this.trackedTouch!.identifier)) {
            this.trackedTouch = null;
            this.isExternalForceActive = false;

            this.startPhysicsAnimation();
        }
    }

    private onTouchMove(event: TouchEvent) {
        const currentTouch = this.trackedTouch && Array.from(event.changedTouches)
            .find(touch => touch.identifier === this.trackedTouch!.identifier);

        if (currentTouch) {
            this.pendingScroll += this.trackedTouch!.screenY - currentTouch.screenY;
            this.startPhysicsAnimation();

            this.trackedTouch = currentTouch;
        }
    }

    private onWheelHandler(event: WheelEvent) {
        const smoothScroll = event.deltaY === Math.round(event.deltaY);

        if (!smoothScroll) {
            // assuming trackpad scroll
            this.isExternalForceActive = true;

            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(() => {
                this.isExternalForceActive = false;
                this.debounceTimer = null;
                if (!this.isWheelStable()) {
                    this.stabilizeWheel();
                }
            }, 600);

            this.pendingScroll += event.deltaY;
            this.startPhysicsAnimation();
        } else {
            // assuming mousewheel scroll
            this.pendingScroll += Math.floor(event.deltaY / ITEM_HEIGHT) * ITEM_HEIGHT;
            this.startPhysicsAnimation();
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'ar-picker': Picker;
    }
}
