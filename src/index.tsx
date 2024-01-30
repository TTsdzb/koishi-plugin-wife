import { Bot, Context, Schema, Universal, h } from "koishi";
import {} from "koishi-plugin-cron";

export const name = "wife";
export const using = ["database", "cron"];

export interface Config {
  tableCleanupTime: number;
  allowDaffodil: boolean;
  allowNtr: boolean;
  allowBots: boolean;
  allowSelf: boolean;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    tableCleanupTime: Schema.number()
      .min(0)
      .max(23)
      .step(1)
      .default(0)
      .description(
        "在何时清空数据库（也就是到几点算作第二天）。以24小时制计。"
      ),
  }).description("存储设置"),
  Schema.object({
    allowDaffodil: Schema.boolean()
      .default(false)
      .description("允许随机到自己。"),
    allowNtr: Schema.boolean()
      .default(false)
      .description("允许随机到其他人的老婆。"),
    allowBots: Schema.boolean()
      .default(false)
      .description("允许随机到平台标注为机器人的账号（除了自身）。"),
    allowSelf: Schema.boolean()
      .default(false)
      .description("允许随机到Bot自身账号。"),
  }).description("随机过滤设置"),
]);

/**
 * Store mappings between guild members.
 */
export interface Wife {
  id: number;
  guildId: string;
  memberId1: string;
  memberId2: string;
}

/**
 * Build the message to return with given member and his/her wife.
 * @param userId Member's ID who triggers the command
 * @param wife The member's wife
 * @returns Message to return
 */
function buildMessage(userId: string, wife: Universal.GuildMember): h {
  return (
    <>
      <at id={userId} />
      <br />
      <i18n path="commands.wife.messages.todaysWifeIs" />
      <br />
      <image url={wife.user.avatar} />
      <br />
      {wife.name ? wife.name : wife.user.name} ({wife.user.id})
    </>
  );
}

/**
 * Get all member of a guild.
 *
 * The API of bot returns paged data. Use this function
 * to get a full set of data.
 * @param bot Bot object of the session
 * @param guildId Id of the target guild
 * @returns All members of the target guild
 */
async function getAllGuildMember(
  bot: Bot,
  guildId: string
): Promise<Universal.GuildMember[]> {
  let members: Universal.GuildMember[] = [];
  // Get the first page
  let membersPage = await bot.getGuildMemberList(guildId);
  members = members.concat(membersPage.data);
  // If there are more pages, get them
  while (membersPage.next) {
    membersPage = await bot.getGuildMemberList(guildId, membersPage.next);
    members = members.concat(membersPage.data);
  }
  return members;
}

export function apply(ctx: Context, config: Config) {
  // Register i18n
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  // Extend a table for storage
  ctx.model.extend(
    "wife_of_the_day",
    {
      id: "unsigned",
      guildId: "string",
      memberId1: "string",
      memberId2: "string",
    },
    {
      primary: "id",
      autoInc: true,
    }
  );

  // Register a cron to clean the table for the next day.
  ctx.cron(`0 ${config.tableCleanupTime} * * *`, async () => {
    await ctx.database.remove("wife_of_the_day", {
      id: { $gte: 0 },
    });
  });

  // Register the command
  ctx.command("wife").action(async ({ session }) => {
    // We use `session.gid` to identify guilds, and session.userId to
    // identify members. The result is designed to be different in
    // different guilds, so there's no need to bind a user between
    // different platforms.

    // Check if the command is triggered in guilds.
    if (!session.guildId)
      return (
        <>
          <i18n path="commands.wife.messages.pleaseUseInGuilds" />
        </>
      );

    // Query the database for result generated earlier.
    const existedWife = await ctx.database.get("wife_of_the_day", {
      guildId: session.gid,
      memberId1: session.userId,
    });

    // If there is pre-generated result, return it.
    if (existedWife.length > 0) {
      const wife = await session.bot.getGuildMember(
        session.guildId,
        existedWife[0].memberId2
      );
      return buildMessage(session.userId, wife);
    }

    // There is no generated result. We should generate a new one.
    // Query members that already be someone's wife.
    const wifes = (
      await ctx.database.get(
        "wife_of_the_day",
        {
          guildId: session.gid,
        },
        ["memberId2"]
      )
    ).map((value) => value.memberId2);
    // Get members that are available to be one's wife.
    const members = (
      await getAllGuildMember(session.bot, session.guildId)
    ).filter(
      (value) =>
        (config.allowNtr || !wifes.includes(value.user.id)) &&
        (value.user.id === session.bot.selfId || // If the member is self, let the next expression handle it
          config.allowBots ||
          !value.user.isBot) &&
        (config.allowSelf || value.user.id !== session.bot.selfId) &&
        (config.allowDaffodil || value.user.id !== session.userId)
    );
    // Check the array to prevent errors.
    if (members.length === 0)
      return (
        <>
          <at id={session.userId} />
          <i18n path="commands.wife.messages.youHaveNoWife" />
        </>
      );
    // Pick a member to be one's wife.
    const wife = members[Math.floor(Math.random() * members.length)];
    // Store the wife to database for later query.
    await ctx.database.create("wife_of_the_day", {
      guildId: session.gid,
      memberId1: session.userId,
      memberId2: wife.user.id,
    });
    // Build and return the message
    return buildMessage(session.userId, wife);
  });
}

declare module "koishi" {
  interface Tables {
    wife_of_the_day: Wife;
  }
}
