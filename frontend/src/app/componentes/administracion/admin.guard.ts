import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiService } from '../../api.service';

export const adminGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);

  return api.adminSession().pipe(
    map(({ authenticated }) => authenticated || router.createUrlTree(['/carmen-admin'])),
    catchError(() => of(router.createUrlTree(['/carmen-admin']))),
  );
};
