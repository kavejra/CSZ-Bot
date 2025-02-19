import {
    CommandInteraction,
    GuildMember,
    PermissionsString,
    User,
    SlashCommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandStringOption,
    SlashCommandUserOption,
} from "discord.js";
import type { Client } from "discord.js";

import Ban from "../../storage/model/Ban.js";
import { getConfig } from "../../utils/configHandler.js";
import type {
    ApplicationCommand,
    CommandResult,
    MessageCommand,
} from "../command.js";
import type { ProcessableMessage } from "../../handler/cmdHandler.js";
import type { BotContext } from "../../context.js";
import log from "../../utils/logger.js";
import moment from "moment";
import { unban } from "./unban.js";

const config = getConfig();

// #region Banned User Role Assignment

const assignBannedRoles = async (user: GuildMember): Promise<boolean> => {
    const defaultRole = user.guild.roles.cache.find(
        role => role.id === config.ids.default_role_id,
    );
    const bannedRole = user.guild.roles.cache.find(
        role => role.id === config.ids.banned_role_id,
    );

    if (!defaultRole || !bannedRole) {
        return false;
    }
    const currentRoles = [...user.roles.cache.map(r => r.id)];
    let newRoles = [...currentRoles, bannedRole.id].filter(
        r => r !== config.ids.default_role_id,
    );

    if (
        user.roles.cache.find(r => r.id === config.ids.gruendervaeter_role_id)
    ) {
        newRoles = newRoles.filter(
            r => r !== config.ids.gruendervaeter_role_id,
        );
        newRoles.push(config.ids.gruendervaeter_banned_role_id);
    }

    if (user.roles.cache.find(r => r.id === config.ids.trusted_role_id)) {
        newRoles = newRoles.filter(r => r !== config.ids.trusted_role_id);
        newRoles.push(config.ids.trusted_banned_role_id);
    }

    await user.edit({ roles: newRoles });
    return true;
};

export const restoreRoles = async (user: GuildMember): Promise<boolean> => {
    log.debug(`Restoring roles from user ${user.id}`);
    const defaultRole = user.guild.roles.cache.find(
        role => role.id === config.ids.default_role_id,
    );
    const bannedRole = user.guild.roles.cache.find(
        role => role.id === config.ids.banned_role_id,
    );

    if (!defaultRole || !bannedRole) {
        return false;
    }
    const currentRoles = [...user.roles.cache.map(r => r.id)];
    let newRoles = [...currentRoles, defaultRole.id].filter(
        r => r !== config.ids.banned_role_id,
    );

    if (
        user.roles.cache.find(
            r => r.id === config.ids.gruendervaeter_banned_role_id,
        )
    ) {
        newRoles = newRoles.filter(
            r => r !== config.ids.gruendervaeter_banned_role_id,
        );
        newRoles.push(config.ids.gruendervaeter_role_id);
    }

    if (
        user.roles.cache.find(r => r.id === config.ids.trusted_banned_role_id)
    ) {
        newRoles = newRoles.filter(
            r => r !== config.ids.trusted_banned_role_id,
        );
        newRoles.push(config.ids.trusted_role_id);
    }

    await user.edit({ roles: newRoles });

    return true;
};

// #endregion

export const processBans = async (context: BotContext) => {
    const now = new Date();

    try {
        const expiredBans = await Ban.findExpiredBans(now);

        for (const expiredBan of expiredBans) {
            log.debug(
                `Expired Ban found by user ${expiredBan.userId}. Expired on ${expiredBan.bannedUntil}`,
            );
            const user = context.guild.members.cache.get(expiredBan.userId);
            // No user, no problem
            if (!user) continue;

            await unban(user);

            const msg = expiredBan.isSelfBan
                ? "Glückwunsch! Dein selbst auferlegter Bann in der Coding Shitpost Zentrale ist beendet."
                : "Glückwunsch! Dein Bann in der Coding Shitpost Zentrale ist beendet. Sei nächstes Mal einfach kein Hurensohn.";

            await user.send(msg);
        }
    } catch (err) {
        log.error(err, "Error processing bans.");
    }
};

export const ban = async (
    client: Client,
    member: GuildMember,
    banInvoker: GuildMember | User,
    reason: string,
    isSelfBan: boolean,
    duration?: number,
) => {
    log.debug(
        `Banning ${member.id} by ${banInvoker.id} because of ${reason} for ${duration}.`,
    );

    // No Shadow ban :(
    const botUser = client.user;
    if (
        member.id === "371724846205239326" ||
        (botUser && member.id === botUser.id)
    )
        return "Fick dich bitte.";

    const existingBan = await Ban.findExisting(member.user);
    if (existingBan !== null) {
        if (member.roles.cache.some(r => r.id === config.ids.banned_role_id)) {
            return "Dieser User ist bereits gebannt du kek.";
        }

        return "Dieser nutzer ist laut Datenbank gebannt, ihm fehlt aber die Rolle. Fix das.";
    }

    const result = await assignBannedRoles(member);
    if (!result) return "Fehler beim Bannen. Bitte kontaktiere einen Admin.";

    const unbanAt =
        duration === undefined || duration === 0
            ? null // never
            : new Date(Date.now() + duration * 60 * 60 * 1000);
    const humanReadableDuration = duration
        ? moment.duration(duration, "hours").locale("de").humanize()
        : undefined;

    const banReasonChannel = member.guild.channels.resolve(
        config.ids.bot_log_channel_id,
    );
    if (banReasonChannel?.isTextBased()) {
        await banReasonChannel.send({
            content: `${member} ${
                isSelfBan ? "hat sich selbst" : `wurde von ${banInvoker}`
            } ${
                humanReadableDuration
                    ? `für ${humanReadableDuration}`
                    : "bis auf unbestimmte Zeit"
            } gebannt. \nGrund: ${reason}`,
            allowedMentions: {
                users: [],
            },
        });
    }

    await Ban.persistOrUpdate(member, unbanAt, isSelfBan, reason);

    await member.send(`Du wurdest von der Coding Shitpost Zentrale gebannt!
${!reason ? "Es wurde kein Banngrund angegeben." : `Banngrund: ${reason}`}
Falls du Fragen zu dem Bann hast, kannst du dich im <#${
        config.ids.banned_channel_id
    }> Channel ausheulen.
Lg & xD™`);
};

export class BanCommand implements ApplicationCommand, MessageCommand {
    name = "ban";
    description = "Joa, bannt halt einen ne?";
    requiredPermissions: readonly PermissionsString[] = ["BanMembers"];

    applicationCommand = new SlashCommandBuilder()
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(0)
        .addUserOption(
            new SlashCommandUserOption()
                .setRequired(true)
                .setName("user")
                .setDescription("Der, der gebannt werden soll"),
        )
        .addStringOption(
            new SlashCommandStringOption()
                .setRequired(true)
                .setName("reason")
                .setDescription("Warum er es verdient hat"),
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
                .setRequired(false)
                .setName("hours")
                .setDescription("Wie lange in Stunden"),
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
                .setRequired(false)
                .setName("minutes")
                .setDescription("Wie lange in Minuten"),
        );

    async handleInteraction(
        command: CommandInteraction,
        client: Client<boolean>,
    ): Promise<void> {
        if (!command.isChatInputCommand()) {
            // TODO: Solve this on a type level
            return;
        }

        const user = command.options.getUser("user", true);
        const invokingUser = command.user;
        const reason = command.options.getString("reason", true);
        const durationHours = command.options.getInteger("hours", false);
        const durationMinutes = command.options.getInteger("minutes", false);
        const duration =
            (durationHours ? durationHours : 0) +
            (durationMinutes ? durationMinutes / 60 : 0);
        const humanReadableDuration = moment
            .duration(duration, "hours")
            .locale("de")
            .humanize();

        const userAsGuildMember = command.guild?.members.resolve(user);
        if (!userAsGuildMember) {
            await command.reply({
                content: "Yo, der ist nicht auf dem Server",
                ephemeral: true,
            });
            return;
        }

        const err = await ban(
            client,
            userAsGuildMember,
            invokingUser,
            reason,
            false,
            duration ?? undefined,
        );

        if (err) {
            await command.reply({
                content: err,
                ephemeral: true,
            });
            return;
        }

        await command.reply({
            content: `Ok Bruder, ich hab ${user} wegen ${reason} ${
                duration > 0 ? `für ${humanReadableDuration}` : ""
            } gebannt`,
        });
        return;
    }

    async handleMessage(
        message: ProcessableMessage,
        client: Client<boolean>,
    ): Promise<CommandResult> {
        const user = message.mentions.users.first();
        const invokingUser = message.author;

        if (!user) {
            await message.reply("Bruder, gib doch einen User an.");
            return;
        }

        const userAsGuildMember = message.guild?.members.resolve(user);

        if (!userAsGuildMember) {
            await message.reply("Bruder, der ist nicht auf diesem Server.");
            return;
        }

        // Extracting the reason in the text-based commmands is kinda tricky ...
        // Especially due to the fact that we don't want to break existing functionallity
        // and want to provide expected behaviour for the mods

        // If we have a reference the first mention is in the reference and the reason is therefore
        // the whole message except the command itself
        const messageAfterCommand = message.content
            .substring(message.content.indexOf(this.name) + this.name.length)
            .trim();
        let reason = "Willkür";
        if (message.reference) {
            if (messageAfterCommand.trim().length > 0) {
                reason = messageAfterCommand;
            }
        } else {
            // Otherwise we would extract everything that is written AFTER the first mention
            const match = /\<@!?[0-9]+\> (.+)/.exec(messageAfterCommand);
            if (match?.[1]) {
                reason = match[1];
            }
        }

        const err = await ban(
            client,
            userAsGuildMember,
            invokingUser,
            reason,
            false,
        );

        if (err) {
            await message.reply({
                content: err,
            });
            return;
        }

        await message.reply({
            content: `Ok Bruder, ich hab ${user} wegen ${reason} gebannt`,
        });
    }
}
