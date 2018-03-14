import { Request, Response, NextFunction } from 'express';
import { controller, httpGet, httpPost } from 'inversify-express-utils';
import { injectable, inject } from 'inversify';
import { VerificationClientType } from '../services/verify.client';
import { IPNServiceType } from '../services/ipn.service';
import { PaymentsServiceType } from '../services/payments.service';
import { CoinpaymentsClientType, CoinPayments } from '../services/coinpayments/coinpayments.client';
import { AuthorizedRequest } from '../requests/authorized.request';
import config from '../config';
import { getConnection } from 'typeorm';
import { PaymentGateTransaction } from '../entities/payment.gate.transaction';

const IPN_RESPONSE_STATUS_COMPLETE = 100;
const IPN_RESPONSE_STATUS_QUEUED_PAYOUT = 2;

const cpMiddleware = CoinPayments.ipn({
  merchantId: config.coinPayments.merchantId,
  merchantSecret: config.coinPayments.merchantSecret
});

@injectable()
@controller(
  '/gateway'
)
export class GatewayController {
  constructor(
    @inject(VerificationClientType) private verificationClient: VerificationClientInterface,
    @inject(CoinpaymentsClientType) private coinpaimentsClient: CoinpaymentsClientInterface,
    @inject(PaymentsServiceType) private paymentsService: PaymentsServiceInterface,
    @inject(IPNServiceType) private ipnService: IPNServiceInterface
  ) { }

  @httpGet(
    '/currencies'
  )
  async currencies(req: Request, res: Response): Promise<void> {
    res.json(await this.coinpaimentsClient.rates());
  }

  @httpPost(
    '/createTransaction',
    'AuthMiddleware'
  )
  async createTransaction(req: AuthorizedRequest, res: Response): Promise<void> {
    try {
      const tx = await this.paymentsService.initiateBuyEths(
        req.user,
        req.body.amount,
        config.coinPayments.currency1,
        req.body.currency
      );

      res.json(tx.buyCoinpaymentsData);
    } catch (error) {
      res.json(error);
    }
  }

  @httpGet(
    '/getTransactions',
    'AuthMiddleware'
  )
  async getPaymentGateTransactions(req: AuthorizedRequest, res: Response): Promise<void> {
    const paymentGateTransactionRepository = getConnection().mongoManager.getMongoRepository(PaymentGateTransaction);
    const txs = await paymentGateTransactionRepository.find({
      where: {userEmail: req.user.email}
    });

    res.json(txs);
  }

  @httpPost(
    '/ipn',
    (req, res, next) => cpMiddleware(req, {end: () => {}}, next)
  )
  async ipn(req: Request, res: Response, next): Promise<void> {
    try {
      if (req.body.status >= IPN_RESPONSE_STATUS_COMPLETE) {
        // complete
        console.log(await this.ipnService.processComplete(req.body));
      } else if (req.body.status < 0) {
        // fail
        console.log(await this.ipnService.processFail(req.body));
      } else {
        // pending
        console.log(await this.ipnService.processPending(req.body));
      }

      res.end('IPN OK');
    } catch (error) {
      res.end('IPN Error: ' + error);
    }
  }
}