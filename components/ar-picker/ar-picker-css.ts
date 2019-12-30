import { html } from "lit-element";

export default html`
    <style>
        .item {
            color: rgba(0, 0, 0, 0.42);
            font-size: 14px;
            line-height: var(--item-height);
            text-align: center;
            user-select: none;
        }

        .item.selected {
            color: black;
            transition: color 0.6s;
        }

        #selection-marker hr {
            background-color: black;
        }
    </style>
`;
