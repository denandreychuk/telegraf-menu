// @ts-ignore
import * as deepEqual from 'deep-equal';
import { BehaviorSubject } from 'rxjs';
import { skip } from 'rxjs/operators';
import { Markup } from 'telegraf';

import { FORMATTING_EMOJIS } from './const';
import {
    DefaultCtx,
    MenuConfig,
    MenuContextUpdate,
    MenuFilters,
    MenuFormatters,
    MenuOption,
    MenuOptionPayload,
    MenuOptionShort,
    MenuType,
} from './interfaces';
import { KeyboardButton } from './keyboard-button';
import { DEFAULT_STATE_MAPPERS } from './mappers';
import { getCtxInfo, reduceArray } from './utils';


export class KeyboardMenu<Ctx extends DefaultCtx = DefaultCtx, Group extends any = any, State extends object = any> {
    get state$() {
        return this._state$
            .asObservable()
            .pipe(skip(1));
    }

    messageId: number;
    state: State;

    private activeButtons: MenuOptionPayload<Group>[] = [];
    private deleted: boolean = false;
    private evenRange: boolean = false;
    private readonly _state$: BehaviorSubject<State> = new BehaviorSubject<State>(null);

    static remapCompactToFull<SGroup>(options: MenuOptionShort<SGroup>): MenuOption<SGroup> {
        const newOption = {
            action: options.a,
            payload: {
                default: !!options.p.d,
                group: options.p.g,
                value: options.p.v,
            },
        };

        if (!options.p.d) {
            delete newOption.payload.default;
        }

        return newOption;
    }

    static remapFullToCompact<SGroup>(options: MenuOption<SGroup>): MenuOptionShort<SGroup> {
        const newOption = {
            a: options.action,
            p: {
                d: Number(!!options.payload.default) as 1 | 0,
                g: options.payload.group,
                v: options.payload.value,
            },
        };

        if (!options.payload.default) {
            delete newOption.p.d;
        }

        return newOption;
    }

    static onAction<Ctx extends DefaultCtx = DefaultCtx>(
        menuGetter: (ctx: Ctx) => KeyboardMenu,
        initMenu: (ctx: Ctx) => any,
    ) {
        return (ctx: MenuContextUpdate<Ctx>) => {
            const oldMenu = menuGetter(ctx);
            if (oldMenu?.onAction) {
                oldMenu.onAction(ctx);
            } else {
                if (oldMenu && !oldMenu.deleted) {
                    ctx.deleteMessage(oldMenu.messageId).catch(() => {});
                    oldMenu.deleted = true;
                }

                initMenu(ctx);
            }
        };
    }

    constructor(
        private config: MenuConfig<Group, State, Ctx>,
        private stateMappers: MenuFormatters<State, MenuFilters<Group>, Group> = DEFAULT_STATE_MAPPERS,
    ) {
        if (config.state) {
            this.updateState(config.state);
        }
    }

    updateState(state: State, ctx?: Ctx) {
        this.activeButtons = this.stateMappers.stateToMenu(
            state,
            this.config.filters,
            this.config.type,
            this.config.groups,
        ).map((button) => button.value);

        this._state$.next(state);
        this.state = state;

        if (ctx) {
            this.redrawMenu(ctx);
        }
    }

    async sendMenu(ctx: Ctx) {
        const { chatId } = getCtxInfo(ctx as any);
        ctx.telegram.sendChatAction(chatId, 'typing');

        const oldMenu = this.config.menuGetter(ctx);
        if (oldMenu?.messageId && !oldMenu.deleted) {
            ctx.deleteMessage(oldMenu.messageId);
        }

        const message = this.config.debug ?
            this.config.message + '\n' + JSON.stringify(this.state) :
            this.config.message;

        const sentMessage = await ctx.reply(message, this.getKeyboard());
        this.messageId = sentMessage.message_id;
    }

    private onAction(ctx: MenuContextUpdate<Ctx, Group>) {
        const messageId = ctx.callbackQuery?.message?.message_id;
        /**
         * If clicked on old inactive keyboard
         * */
        if (!this.messageId) {
            ctx.deleteMessage(messageId).catch(() => {});
            this.sendMenu(ctx as any);
        } else if (this.messageId !== messageId) {
            ctx.deleteMessage(messageId).catch(() => {});
            return;
        }

        const payload = ctx.state.callbackData?.payload;
        if (payload?.group === '_local' && payload?.value === '_submit') {
            this.config.onSubmit(ctx, this.state);
            this.deleted = true;

            if (this.config.onSubmitUpdater) {
                this.config.onSubmitUpdater(ctx, messageId, this.state);
            } else {
                ctx.deleteMessage(messageId).catch(() => {});
            }
            return;
        }

        this.toggleActiveButton(ctx as any, ctx.state.callbackData.payload as any);
        this.config.onChange?.(ctx, this.state);
    }

    private toggleActiveButton(ctx: Ctx, activeButton: MenuOptionPayload<Group>) {
        let activeButtons = this.stateMappers.stateToMenu(
            this.state,
            this.config.filters,
            this.config.type,
            this.config.groups,
        ).map((button) => button.value);

        const { chatId } = getCtxInfo(ctx as any);
        ctx.telegram.sendChatAction(chatId, 'typing');

        switch (this.config.type) {
            case MenuType.RADIO:
                activeButtons = activeButtons.filter((button) => button.group !== activeButton.group);
                activeButtons.push(activeButton);
                break;

            case MenuType.RANGE:
                const {
                    activeButtonIndex,
                    firstButtonIndex,
                    lastButtonIndex,
                    firstButton,
                    lastButton,
                } = this.getRangeButtonIndexes(activeButton);

                activeButtons = this.evenRange
                    ? [firstButton, activeButton]
                    : [activeButton, lastButton];
                activeButtons = activeButtons.filter(Boolean);

                if (this.evenRange && activeButtonIndex < firstButtonIndex || !this.evenRange && activeButtonIndex > lastButtonIndex) {
                    activeButtons = activeButtons.reverse();
                    this.evenRange = !this.evenRange;
                }

                break;

            case MenuType.CHECKBOX:
                let buttonIndex = null;

                activeButtons.some((button, index) => {
                    const isButtonInList = deepEqual(button, activeButton);

                    if (isButtonInList) {
                        buttonIndex = index;
                        return true;
                    }
                });

                if (buttonIndex || buttonIndex === 0) {
                    activeButtons.splice(buttonIndex, 1);
                } else {
                    activeButtons.push(activeButton);
                }
                break;
        }

        const newState = this.stateMappers.menuToState(activeButtons, this.config.type, this.config.groups);
        this.activeButtons = activeButtons;
        this._state$.next(newState);
        this.state = newState;
        this.evenRange = !this.evenRange;

        this.redrawMenu(ctx);
    }

    private redrawMenu(ctx: Ctx) {
        const { chatId } = getCtxInfo(ctx as any);
        const message = this.config.debug ?
            this.config.message + '\n' + JSON.stringify(this.state) :
            this.config.message;

        if (this.messageId) {
                ctx.telegram
                    .editMessageText(chatId, this.messageId, null, message, this.getKeyboard())
                    .catch((e) => {
                        console.log(e);
                    });
        }
    }

    private getKeyboard() {
        const buttons = this.config.filters.map((row) => {
            return row.map((button) => {
                const shortButton = KeyboardMenu.remapFullToCompact({
                    action: this.config.action,
                    payload: button.value,
                });

                return Markup.button.callback(this.formatButtonLabel(button), JSON.stringify(shortButton));
            });
        });

        if (this.config.onSubmit) {
            const shortButton = KeyboardMenu.remapFullToCompact({
                action: this.config.action,
                payload: { group: '_local', value: '_submit' },
            });

            const callbackButton = Markup.button.callback(this.config.submitMessage || 'Submit', JSON.stringify(shortButton));

            buttons.push([callbackButton]);
        }

        return Markup.inlineKeyboard(buttons);
    }

    private getRangeButtonIndexes(currentButton: MenuOptionPayload<Group>) {
        const allButtons = this.config.filters.reduce(reduceArray);
        const firstButton = this.activeButtons[0];
        const lastButton = this.activeButtons[1];

        const firstDefault = allButtons.findIndex((button) => !!button.value.default);

        const activeButtonIndex = allButtons
            .findIndex((button) => button.value.value === currentButton.value);

        const firstButtonIndex = allButtons
            .findIndex((button) => {
                return firstButton
                    ? button.value.value === firstButton.value
                    : !!button.value.default;
            });

        const lastButtonIndex = allButtons
            .findIndex((button, index) => {
                return lastButton
                    ? button.value.value === lastButton.value
                    : !!button.value.default && firstDefault !== index;
            });

        return {
            firstButton: firstButton || allButtons[firstButtonIndex].value,
            lastButton : lastButton || allButtons[lastButtonIndex].value,
            activeButtonIndex,
            firstButtonIndex,
            lastButtonIndex,
        };
    }

    private formatButtonLabel(button: KeyboardButton<MenuOptionPayload<Group>>) {
        const { CHECKBOX_FORMATTING, RADIO_FORMATTING, RANGE_FORMATTING } = FORMATTING_EMOJIS;

        const isDefaultActiveButton = this.activeButtons
            .filter((activeButton) => activeButton.group === button.value.group)
            .length === 0 && !!button.value.default;

        const isActiveButton = this.activeButtons.some((activeButton) => {
            return deepEqual(activeButton, button.value);
        });

        switch (this.config.type) {
            case MenuType.RANGE:
                const { activeButtonIndex, firstButtonIndex, lastButtonIndex } = this.getRangeButtonIndexes(button.value);
                const isButtonInRange = activeButtonIndex >= firstButtonIndex && activeButtonIndex <= lastButtonIndex;
                const isCurrentButton = this.evenRange && activeButtonIndex === lastButtonIndex ||
                    !this.evenRange && activeButtonIndex === firstButtonIndex;

                if (isCurrentButton) {
                    return RANGE_FORMATTING.current + ' ' + button.label;
                }

                return isActiveButton || isButtonInRange || isDefaultActiveButton ?
                    RANGE_FORMATTING.active + ' ' + button.label :
                    RANGE_FORMATTING.disabled + ' ' + button.label;

            case MenuType.RADIO:
                return isActiveButton || isDefaultActiveButton ?
                    RADIO_FORMATTING.active + ' ' + button.label :
                    RADIO_FORMATTING.disabled + ' ' + button.label;

            case MenuType.CHECKBOX:
                return isActiveButton ?
                    CHECKBOX_FORMATTING.active + ' ' + button.label :
                    CHECKBOX_FORMATTING.disabled + ' ' + button.label;
        }
    }
}
