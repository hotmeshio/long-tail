import { render, screen, fireEvent } from '@testing-library/react';
import { JsonViewer } from '../JsonViewer';

describe('JsonViewer', () => {
  it('renders a label when provided', () => {
    render(<JsonViewer data={null} label="Payload" />);
    expect(screen.getByText('Payload')).toBeInTheDocument();
  });

  it('renders null values', () => {
    render(<JsonViewer data={null} />);
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('renders string values with quotes', () => {
    render(<JsonViewer data="hello" />);
    expect(screen.getByText(/"hello"/)).toBeInTheDocument();
  });

  it('renders number values', () => {
    render(<JsonViewer data={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders boolean values', () => {
    render(<JsonViewer data={true} />);
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('renders empty array as []', () => {
    render(<JsonViewer data={[]} />);
    expect(screen.getByText('[]')).toBeInTheDocument();
  });

  it('renders empty object as {}', () => {
    render(<JsonViewer data={{}} />);
    expect(screen.getByText('{}')).toBeInTheDocument();
  });

  it('parses JSON strings automatically', () => {
    render(<JsonViewer data='{"name":"test"}' />);
    expect(screen.getByText('name')).toBeInTheDocument();
  });

  it('renders non-JSON strings as plain strings', () => {
    render(<JsonViewer data="not json {" />);
    expect(screen.getByText(/"not json \{"/)).toBeInTheDocument();
  });

  it('renders object keys at depth 0 (expanded)', () => {
    render(<JsonViewer data={{ key: 'val' }} />);
    expect(screen.getByText('key')).toBeInTheDocument();
  });
});
