import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminContactMessage } from '../../api.service';
import { AdminContactMessagesApiService } from '../../admin-contact-messages-api.service';
import { AdminContactMessages } from './admin-contact-messages.component';

const sampleMessage: AdminContactMessage = {
  id: 41,
  name: 'Ana Prueba',
  email: 'ana@example.test',
  phone: '+34 600 000 000',
  subject: 'Consulta de disponibilidad',
  message: [{ role: 'contact', body: '¿Hay disponibilidad para dos personas?', sent_at: '2026-11-01T10:00:00.000Z' }],
  status: 'pending',
  created_at: '2026-11-01T10:00:00.000Z',
};

describe('AdminContactMessages', () => {
  let api: {
    messages: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<AdminContactMessages>;

  beforeEach(async () => {
    api = {
      messages: vi.fn(() => of([sampleMessage])),
      reply: vi.fn(() => of({ ok: true })),
      delete: vi.fn(() => of({ ok: true })),
    };
    await TestBed.configureTestingModule({
      imports: [AdminContactMessages],
      providers: [
        provideRouter([]),
        { provide: AdminContactMessagesApiService, useValue: api as unknown as AdminContactMessagesApiService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminContactMessages);
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('loads the message list with the default filters', () => {
    expect(api.messages).toHaveBeenCalledWith({
      from_date: undefined,
      to_date: undefined,
      status: 'all',
      search: undefined,
    });
    expect(fixture.nativeElement.textContent).toContain('Ana Prueba');
    expect(fixture.nativeElement.textContent).toContain('Pendiente');
  });

  it('stores a reply request for the selected conversation', () => {
    fixture.componentInstance.openReply(sampleMessage);
    fixture.componentInstance.replyForm.setValue({ message: '  Gracias por escribirnos.  ' });
    fixture.componentInstance.sendReply();

    expect(api.reply).toHaveBeenCalledWith(41, 'Gracias por escribirnos.');
    expect(fixture.componentInstance.replyingTo()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('guardada en la conversación');
  });

  it('requires confirmation before deleting a message', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance.deleteMessage(sampleMessage);
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
