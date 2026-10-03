import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import { NotificationTextField } from './NotificationTextField';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NotificationTextField
        id="body"
        value={value}
        onChange={setValue}
        variables={['user.username', 'server.name']}
        multiline
        maxLength={2000}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('NotificationTextField', () => {
  it('inserts a chosen variable at the cursor', async () => {
    const user = userEvent.setup();
    render(<Harness initial="hi " />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{End}');
    await user.click(screen.getByRole('button', { name: 'Insert variable' }));
    await user.click(await screen.findByRole('option', { name: /Account username/ }));
    expect(screen.getByTestId('value').textContent).toBe('hi {{ user.username }}');
  });

  it('opens the list on {{ and replaces the braces with the choice', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'on {{{{');
    await user.click(await screen.findByRole('option', { name: /Server name/ }));
    expect(screen.getByTestId('value').textContent).toBe('on {{ server.name }}');
  });

  it('keeps typing in the field after {{', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('hi {{{{ user.username }}');
    expect(screen.getByTestId('value').textContent).toBe('hi {{ user.username }}');
    expect(box).toHaveFocus();
  });

  it('filters by what follows {{ and inserts the highlighted name on Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('on {{{{ser');
    const option = await screen.findByRole('option', { name: /Server name/ });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(box).toHaveAttribute('aria-activedescendant', option.id);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('on {{ server.name }}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
  });

  it('closes the typed list on Escape with focus left in the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{{{{');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(box).toHaveFocus();
  });

  it('closes the typed list when a space follows {{', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{{{{');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard(' ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('returns focus to the field when the variable menu closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Insert variable' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });

  it('moves the highlight with the arrow keys and starts at the top on each {{', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('a {{{{ser{Enter} b {{{{');
    const selected = () => screen.getByRole('option', { selected: true });
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(selected()).toHaveTextContent('user.username');
    await user.keyboard('{ArrowDown}');
    expect(selected()).toHaveTextContent('server.name');
    expect(box).toHaveAttribute('aria-activedescendant', selected().id);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('a {{ server.name }} b {{ server.name }}');
  });
});
