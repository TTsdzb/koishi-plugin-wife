import { Bot, Context, Schema, Universal, h } from "koishi";
import {} from "@koishijs/cache";

export const name = "wife";
export const using = ["cache"];

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
      .description("数据在何时失效（也就是到几点算作第二天）。以24小时制计。"),
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

declare module "@koishijs/cache" {
  interface Tables {
    [key: `wife_of_the_day_${string}`]: string;
  }
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

/**
 * Calculate `maxAge` for a cache entry.
 * @param cleanupTime Preset cleanup time
 * @returns Proper age of the cache entry
 */
function getAge(cleanupTime: number): number {
  const currentTime = Date.now();

  const tomorrow = new Date(currentTime + 24 * 60 * 60 * 1000);
  tomorrow.setHours(cleanupTime, 0, 0, 0);
  const tomorrowTime = tomorrow.getTime();

  return tomorrowTime - currentTime;
}

export function apply(ctx: Context, config: Config) {
  // Register i18n
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

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
    const existedWife = await ctx.cache.get(
      `wife_of_the_day_${session.gid}`,
      session.userId
    );

    // If there is pre-generated result, return it.
    if (existedWife) {
      const wife = await session.bot.getGuildMember(
        session.guildId,
        existedWife
      );
      return buildMessage(session.userId, wife);
    }

    // There is no generated result. We should generate a new one.
    // Query members that already be someone's wife.
    const wifeAsyncIterator = ctx.cache.values(
      `wife_of_the_day_${session.gid}`
    );
    const wifes = [];
    for await (const wife of wifeAsyncIterator) wifes.push(wife);
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
    await ctx.cache.set(
      `wife_of_the_day_${session.gid}`,
      session.userId,
      wife.user.id,
      getAge(config.tableCleanupTime)
    );
    // Build and return the message
    return buildMessage(session.userId, wife);
  });
}
