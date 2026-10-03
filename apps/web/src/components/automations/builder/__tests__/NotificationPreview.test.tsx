import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import { NotificationPreview } from '../NotificationPreview';

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: () => ({
    data: [
      { id: 'd-discord', type: 'discord', name: 'My Discord' },
      { id: 'd-push', type: 'pushover', name: 'My Pushover' },
      { id: 'd-hook', type: 'json_webhook', name: 'My Webhook' },
      { id: 'd-email', type: 'email', name: 'My Email' },
      { id: 'd-apprise', type: 'apprise', name: 'My Apprise' },
      { id: 'd-toast', type: 'web_toast', name: 'My Toasts' },
      { id: 'd-app', type: 'push', name: 'My App' },
    ],
  }),
}));

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

describe('NotificationPreview', () => {
  it('shows one tab per chosen destination type, rendered from samples', () => {
    render(<NotificationPreview title="Hi {{ user.username }}" to={['d-discord', 'd-push']} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('Hi alex')).toBeInTheDocument();
  });

  it('cuts the body to the chosen tab limit and counts against it', async () => {
    const user = userEvent.setup();
    render(<NotificationPreview body={'b'.repeat(1500)} to={['d-push']} />);
    await user.click(screen.getByRole('tab', { name: /Pushover/ }));
    expect(screen.getByText(/1,500 \/ 1,024/)).toBeInTheDocument();
    expect(screen.getByText(/cut to fit/)).toBeInTheDocument();
  });

  it('fits Discord text after escaping and shows it unescaped', () => {
    render(
      <NotificationPreview
        body={`{{ missing | default: "${'_'.repeat(3000)}" }}`}
        to={['d-discord']}
      />
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent(`${'_'.repeat(2047)}…`);
    expect(screen.getByText(/6,000 \/ 4,096/)).toBeInTheDocument();
  });

  it('selects the first tab when the chosen destinations change under it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NotificationPreview body="hi" to={[]} />);
    rerender(<NotificationPreview body="hi" to={['d-discord']} />);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/Discord/);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('hi');

    rerender(<NotificationPreview body="hi" to={['d-discord', 'd-push']} />);
    await user.click(screen.getByRole('tab', { name: /Pushover/ }));
    rerender(<NotificationPreview body="hi" to={['d-discord']} />);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/Discord/);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('hi');
  });

  it('shows a single webhook tab with its keys and no counter', () => {
    render(<NotificationPreview title="Hi" body="hi" to={['d-hook']} />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText('automation.title')).toBeInTheDocument();
    expect(screen.getByText('automation.message')).toBeInTheDocument();
    expect(screen.queryByText(/ \/ \d/)).not.toBeInTheDocument();
  });

  it('shows a neutral panel and no tab bar when nothing is chosen', () => {
    render(<NotificationPreview to={[]} />);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Message')).toBeInTheDocument();
    expect(screen.getByText('0 / 200')).toBeInTheDocument();
    expect(screen.getByText('0 / 2,000')).toBeInTheDocument();
    expect(
      screen.getByText('Pick a destination to see how each one shows this')
    ).toBeInTheDocument();
  });

  it('shows Discord and a webhook as two tabs', () => {
    render(<NotificationPreview body="hi" to={['d-discord', 'd-hook']} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('labels each destination the way it shows the fields', async () => {
    const user = userEvent.setup();
    render(
      <NotificationPreview
        title="T"
        body="B"
        to={['d-discord', 'd-email', 'd-apprise', 'd-app', 'd-toast']}
      />
    );
    const panel = () => screen.getByRole('tabpanel');
    expect(within(panel()).getByText('Embed title')).toBeInTheDocument();
    expect(within(panel()).getByText('Description')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Email/ }));
    expect(within(panel()).getByText('Subject')).toBeInTheDocument();
    expect(within(panel()).getByText('Message')).toBeInTheDocument();

    for (const name of [/Apprise/, /Mobile/, /Browser/]) {
      await user.click(screen.getByRole('tab', { name }));
      expect(within(panel()).getByText('Title')).toBeInTheDocument();
      expect(within(panel()).getByText('Message')).toBeInTheDocument();
    }
  });

  it('counts the title on its own', () => {
    render(
      <NotificationPreview title="Hi {{ user.username }}" body="hello there" to={['d-push']} />
    );
    expect(screen.getByText('7 / 250')).toBeInTheDocument();
    expect(screen.getByText('11 / 1,024')).toBeInTheDocument();
  });

  it('shows the uncapped count with thousands separators when the body is cut', () => {
    render(<NotificationPreview body={'b'.repeat(4310)} to={['d-discord']} />);
    expect(screen.getByText(/4,310 \/ 4,096/)).toBeInTheDocument();
    expect(screen.getByText(/cut to fit/).tagName).toBe('OUTPUT');
  });

  it('names Tracearr as the source of an empty field', () => {
    render(<NotificationPreview to={['d-push']} />);
    expect(screen.getAllByText("Tracearr's default for this event")).toHaveLength(2);
  });

  it('shows the set priority on Pushover and automatic when unset', () => {
    const { rerender } = render(<NotificationPreview body="hi" to={['d-push']} priority="high" />);
    expect(screen.getByText('Priority: High')).toBeInTheDocument();
    rerender(<NotificationPreview body="hi" to={['d-push']} />);
    expect(screen.getByText('Priority: Automatic')).toBeInTheDocument();
  });

  it('shows no priority on Apprise', () => {
    render(<NotificationPreview body="hi" to={['d-apprise']} priority="high" />);
    expect(screen.queryByText(/Priority:/)).not.toBeInTheDocument();
  });

  it('says the values are samples', () => {
    render(<NotificationPreview body="hi" to={[]} />);
    expect(screen.getByText(/sample values, for example alex as the user/)).toBeInTheDocument();
  });

  it('keeps an empty status region in the counter while within the limit', () => {
    const { container } = render(<NotificationPreview body="hi" to={['d-push']} />);
    const outputs = container.querySelectorAll('output');
    expect(outputs.length).toBeGreaterThan(0);
    outputs.forEach((output) => expect(output).toBeEmptyDOMElement());
  });

  it('says the webhook leaves an empty field out', () => {
    render(<NotificationPreview body="hi" to={['d-hook']} />);
    expect(
      screen.getByText("Not sent. The payload carries the event's own data.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Tracearr's default for this event")).not.toBeInTheDocument();
  });

  it('collapses each run of newlines in the email subject to one space, as the server does', () => {
    render(<NotificationPreview title={'a \nb'} to={['d-email']} />);
    expect(screen.getByText('a  b', { normalizer: (text) => text })).toBeInTheDocument();
  });

  it('counts a blank field as zero', () => {
    render(<NotificationPreview body="   " to={['d-push']} />);
    expect(screen.getByText('0 / 1,024')).toBeInTheDocument();
  });
});
