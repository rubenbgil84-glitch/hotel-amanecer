import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ApiService,
  GalleryAlbumSummary,
  GalleryAlbumDetail,
} from '../../api.service';
import { optimizeImageToDataUrl } from '../compartidos/optimize-image';
import { RoomGallery } from '../compartidos/room-gallery/room-gallery.component';

@Component({
  selector: 'app-galeria',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, RoomGallery],
  templateUrl: './galeria.component.html',
  styleUrl: './galeria.component.scss',
})
export class Galeria {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly albums = signal<GalleryAlbumSummary[]>([]);
  readonly album = signal<GalleryAlbumDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly activePhotoIndex = signal(0);
  readonly submittingComment = signal(false);
  readonly uploadingPhotos = signal(false);
  readonly commentError = signal('');
  readonly commentNotice = signal('');
  readonly uploadError = signal('');
  readonly uploadNotice = signal('');
  readonly photoUrls = computed(() => this.album()?.photos.map((photo) => photo.image_url) ?? []);
  readonly activePhoto = computed(() => this.album()?.photos[this.activePhotoIndex()] ?? null);

  commentDraft = { display_name: '', message: '' };
  uploadDraft = { submitted_by: '', caption: '' };

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.error.set('');
      this.album.set(null);
      this.activePhotoIndex.set(0);
      const slug = params.get('slug');
      if (slug) {
        this.loadAlbum(slug);
      } else {
        this.loadAlbums();
      }
    });
  }

  submitComment(): void {
    const album = this.album();
    const name = this.commentDraft.display_name.trim();
    const message = this.commentDraft.message.trim();
    this.commentError.set('');
    this.commentNotice.set('');
    if (!album?.allow_comments || this.submittingComment()) return;
    if (name.length < 2 || name.length > 80 || message.length < 2 || message.length > 1500) {
      this.commentError.set('Indica un nombre de 2 a 80 caracteres y un comentario de 2 a 1500 caracteres.');
      return;
    }

    this.submittingComment.set(true);
    this.api.submitGalleryComment(album.slug, { display_name: name, message })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submittingComment.set(false);
          this.commentDraft = { display_name: '', message: '' };
          this.commentNotice.set(result.message);
        },
        error: (error: HttpErrorResponse) => {
          console.error('No se pudo enviar el comentario de la galería.', error);
          this.commentError.set(error.error?.errors?.[0] ?? 'No se pudo enviar el comentario. Inténtalo más tarde.');
          this.submittingComment.set(false);
        },
      });
  }

  async uploadPhotos(event: Event): Promise<void> {
    const album = this.album();
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.uploadError.set('');
    this.uploadNotice.set('');
    if (!album?.allow_uploads || this.uploadingPhotos() || !files.length) return;
    if (files.length > 5) {
      this.uploadError.set('Puedes enviar hasta 5 fotos a la vez.');
      input.value = '';
      return;
    }
    const name = this.uploadDraft.submitted_by.trim();
    if (name.length < 2 || name.length > 80) {
      this.uploadError.set('Indica tu nombre (entre 2 y 80 caracteres) antes de elegir las fotos.');
      input.value = '';
      return;
    }
    this.uploadingPhotos.set(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        const imageDataUrl = await optimizeImageToDataUrl(file);
        await firstValueFrom(this.api.uploadGalleryPhoto(album.slug, {
          image_data_url: imageDataUrl,
          submitted_by: name,
          caption: this.uploadDraft.caption.trim(),
        }));
        uploaded += 1;
      }
      this.uploadNotice.set(`${uploaded} ${uploaded === 1 ? 'foto enviada' : 'fotos enviadas'} para revisión. Aparecerán cuando el equipo las apruebe.`);
      this.uploadDraft.caption = '';
    } catch (error) {
      console.error('No se pudieron procesar o enviar las fotos de la galería.', error);
      this.uploadError.set(this.requestError(error, 'No se pudo enviar la foto. Comprueba el formato y el tamaño.'));
      if (uploaded) {
        this.uploadNotice.set(`${uploaded} ${uploaded === 1 ? 'foto se ha enviado' : 'fotos se han enviado'} para revisión antes del error.`);
      }
    } finally {
      this.uploadingPhotos.set(false);
      input.value = '';
    }
  }

  selectPhoto(index: number): void {
    this.activePhotoIndex.set(index);
  }

  private loadAlbums(): void {
    this.loading.set(true);
    this.api.galleryAlbums().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (albums) => {
        this.albums.set(albums);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar los álbumes de la galería.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo cargar la galería. Inténtalo de nuevo más tarde.');
        this.loading.set(false);
      },
    });
  }

  private loadAlbum(slug: string): void {
    this.loading.set(true);
    this.api.galleryAlbum(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (album) => {
        this.album.set(album);
        this.activePhotoIndex.set(0);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo cargar el álbum de fotos.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo cargar el álbum. Inténtalo de nuevo más tarde.');
        this.loading.set(false);
      },
    });
  }

  private requestError(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse
      ? error.error?.errors?.[0] ?? fallback
      : error instanceof Error ? error.message : fallback;
  }
}
