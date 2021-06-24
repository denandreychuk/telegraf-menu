import { FORMATTING_EMOJIS } from '../const';
import { GenericMenu } from '../generic-menu';
import { DefaultCtx, MenuOption, RadioConfig } from '../interfaces';
import { KeyboardButton } from '../keyboard-button';


export class RadioMenu<
    TCtx extends DefaultCtx = DefaultCtx,
    TState extends string = string,
    TValue extends string = string,
    > extends GenericMenu<TCtx, TState, TValue> {
    constructor(private config: RadioConfig<TCtx, TState, TValue>) {
        super(config);
    }

    stateToMenu(state: string): KeyboardButton<TValue>[] {
        const allButtons = this.flatFilters;
        const newButtons: KeyboardButton<TValue>[] = [];

        const currentButton = allButtons.find((button) => button.value === state);
        newButtons.push(currentButton);

        return newButtons.filter(Boolean);
    }

    menuToState(menu: TValue[]): TValue {
        return menu[0];
    }

    onActiveButton(ctx: TCtx, activeButton: MenuOption<TValue>) {
        const activeButtons = [activeButton.value];
        super.toggleActiveButton(ctx, activeButtons);
    }

    formatButtonLabel(ctx: TCtx, button: KeyboardButton<TValue>) {
        const {RADIO_FORMATTING} = FORMATTING_EMOJIS;
        const {label, isDefaultActiveButton, isActiveButton} = super.getButtonLabelInfo(ctx, button);

        return isActiveButton || isDefaultActiveButton ?
            RADIO_FORMATTING.active + ' ' + label :
            RADIO_FORMATTING.disabled + ' ' + label;
    }
}