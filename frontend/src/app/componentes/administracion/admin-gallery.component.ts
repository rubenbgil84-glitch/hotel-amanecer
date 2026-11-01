import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminGalleryAlbum,
  AdminGalleryAlbumDetail,
  ApiService,
  GalleryComment,
  GalleryPhoto,
} from '../../api.service';
import { optimizeImageToDataUrl } from '../compartidos/optimize-image';

@Component({
  selector: 'app-admin-gallery',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-gallery.component.html',
  styleUrl: './admin-gallery.component.scss',
})
export class AdminGallery {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly albums = signal<AdminGalleryAlbum[]>([]);
  readonly selectedAlbum = signal<AdminGalleryAlbumDetail | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly actionId = signal<string | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly uploadError = signal('');
  readonly uploadNotice = signal('');
  readonly isEditing = signal(false);
  readonly newPhotoCaption = signal('');

  readonly createForm = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    description: ['', Validators.maxLength(3000)],
    allow_comments: [false],
    allow_uploads: [false],
  });

  readonly albumForm = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    description: ['', Validators.maxLength(3000)],
    allow_comments: [false],
    allow_uploads: [false],
  });

  constructor() {
    this.loadAlbums();
  }

  createAlbum(): void {
    if (this.saving()) return;
    this.clearMessages();
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) {
      this.error.set('Revisa el título y la descripción del álbum.');
      return;
    }
    this.saving.set(true);
    this.api.createGalleryAlbum(this.createForm.getRawValue()).subscribe({
      next: (album) => {
        this.saving.set(false);
        this.createForm.reset({ title: '', description: '', allow_comments: false, allow_uploads: false });
        this.notice.set('Álbum creado.');
        this.loadAlbums();
        this.selectAlbumById(album.id);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showError(error, 'No se pudo crear el álbum.');
      },
    });
  }

  selectAlbum(album: AdminGalleryAlbum): void {
    this.selectAlbumById(album.id);
  }

  saveAlbum(): void {
    const album = this.selectedAlbum();
    if (!album || this.saving()) return;
    this.clearMessages();
    this.albumForm.markAllAsTouched();
    if (this.albumForm.invalid) {
      this.error.set('Revisa el título y la descripción del álbum.');
      return;
    }
    this.saving.set(true);
    this.api.updateGalleryAlbum(album.id, this.albumForm.getRawValue()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.notice.set('Cambios del álbum guardados.');
        this.loadAlbums();
        this.selectAlbumById(updated.id);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showError(error, 'No se pudieron guardar los cambios.');
      },
    });
  }

  async uploadPhotos(event: Event): Promise<void> {
    const album = this.selectedAlbum();
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.uploadError.set('');
    this.uploadNotice.set('');
    if (!album || this.uploading() || !files.length) return;
    this.uploading.set(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        const imageDataUrl = await optimizeImageToDataUrl(file);
        await firstValueFrom(this.api.uploadAdminGalleryPhoto(album.id, {
          image_data_url: imageDataUrl,
          caption: this.newPhotoCaption().trim(),
        }));
        uploaded += 1;
      }
      this.uploadNotice.set(`${uploaded} ${uploaded === 1 ? 'foto añadida' : 'fotos añadidas'} y publicada${uploaded === 1 ? '' : 's'}.`);
      this.newPhotoCaption.set('');
      this.loadAlbum(album.id);
    } catch (error) {
      console.error('No se pudieron optimizar o subir las fotos de administración.', error);
      this.uploadError.set(this.requestError(error, 'No se pudo subir la foto seleccionada.'));
      if (uploaded) this.loadAlbum(album.id);
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  moderatePhoto(photo: GalleryPhoto, status: 'approved' | 'rejected'): void {
    if (this.actionId() !== null) return;
    this.actionId.set(photo.id);
    this.clearMessages();
    this.api.moderateGalleryPhoto(photo.id, status).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set(status === 'approved' ? 'Foto aprobada y visible en la galería.' : 'Foto retirada de la galería pública.');
        this.refreshSelected();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showError(error, 'No se pudo actualizar la moderación de la foto.');
      },
    });
  }

  moderateComment(comment: GalleryComment, status: 'approved' | 'rejected'): void {
    if (this.actionId() !== null) return;
    this.actionId.set(comment.id);
    this.clearMessages();
    this.api.moderateGalleryComment(comment.id, status).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set(status === 'approved' ? 'Comentario aprobado y publicado.' : 'Comentario rechazado.');
        this.refreshSelected();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showError(error, 'No se pudo actualizar la moderación del comentario.');
      },
    });
  }

  deletePhoto(photo: GalleryPhoto): void {
    if (!window.confirm('¿Eliminar esta foto del álbum? Esta acción no se puede deshacer.')) return;
    if (this.actionId() !== null) return;
    this.actionId.set(photo.id);
    this.clearMessages();
    this.api.deleteGalleryPhoto(photo.id).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set('Foto eliminada del álbum.');
        this.refreshSelected();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showError(error, 'No se pudo eliminar la foto.');
      },
    });
  }

  deleteAlbum(): void {
    const album = this.selectedAlbum();
    if (!album || !window.confirm(`¿Eliminar el álbum «${album.title}», todas sus fotos y comentarios? Esta acción no se puede deshacer.`)) return;
    if (this.saving()) return;
    this.saving.set(true);
    this.clearMessages();
    this.api.deleteGalleryAlbum(album.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.selectedAlbum.set(null);
        this.isEditing.set(false);
        this.notice.set('Álbum eliminado.');
        this.loadAlbums();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showError(error, 'No se pudo eliminar el álbum.');
      },
    });
  }

  editAlbum(): void {
    const album = this.selectedAlbum();
    if (!album) return;
    this.albumForm.patchValue({
      title: album.title,
      description: album.description,
      allow_comments: album.allow_comments,
      allow_uploads: album.allow_uploads,
    });
    this.isEditing.set(true);
    this.clearMessages();
  }

  cancelEdit(): void {
    this.isEditing.set(false);
    this.error.set('');
  }

  statusLabel(status: GalleryPhoto['status']): string {
    return status === 'approved' ? 'Publicada' : status === 'rejected' ? 'Rechazada' : 'Pendiente';
  }

  private selectAlbumById(id: string): void {
    this.isEditing.set(false);
    this.api.adminGalleryAlbum(id).subscribe({
      next: (album) => {
        this.selectedAlbum.set(album);
        this.albumForm.patchValue({
          title: album.title,
          description: album.description,
          allow_comments: album.allow_comments,
          allow_uploads: album.allow_uploads,
        });
      },
      error: (error: HttpErrorResponse) => this.showError(error, 'No se pudo abrir el álbum.'),
    });
  }

  private refreshSelected(): void {
    const album = this.selectedAlbum();
    if (!album) return;
    this.loadAlbums();
    this.selectAlbumById(album.id);
  }

  private loadAlbum(id: string): void {
    this.selectAlbumById(id);
  }

  private loadAlbums(): void {
    this.loading.set(true);
    this.api.adminGalleryAlbums().subscribe({
      next: (albums) => {
        this.albums.set(albums);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.showError(error, 'No se pudieron cargar los álbumes.');
      },
    });
  }

  private showError(error: HttpErrorResponse, fallback: string): void {
    console.error(fallback, error);
    this.error.set(error.error?.errors?.[0] ?? fallback);
  }

  private requestError(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse
      ? error.error?.errors?.[0] ?? fallback
      : error instanceof Error ? error.message : fallback;
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }
}
