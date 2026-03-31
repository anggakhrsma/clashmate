import { CommandInteraction } from 'discord.js';
import { Args, Command } from '../../lib/handlers.js';

export default class MyIpCommand extends Command {
  public constructor() {
    super('myip', {
      category: 'owner',
      ownerOnly: true,
      defer: true,
      ephemeral: true
    });
  }

  public args(): Args {
    return {};
  }

  public async exec(interaction: CommandInteraction) {
    const res = await fetch('https://ifconfig.me/ip');
    const ip = await res.text();
    return interaction.editReply(`**Outbound IP:** \`${ip.trim()}\``);
  }
}
